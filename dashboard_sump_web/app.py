"""
Backend API — Dashboard Prediksi Elevasi Muka Air Sump
=========================================================

Menyediakan endpoint yang dipakai oleh static/script.js:
  GET  /api/model-info          -> metrik performa model (RMSE, MAE, R², dsb)
  GET  /api/historical          -> data historis untuk grafik tren
  GET  /api/constants           -> nilai konstanta lapangan (C, Luas, Debit Pompa)
  GET  /api/rentang-input       -> rentang data historis (untuk hint & peringatan ekstrapolasi)
  GET  /api/feature-importance  -> kontribusi tiap fitur ke prediksi
  POST /api/predict             -> prediksi elevasi besok (skenario pompa ON & OFF)

MODEL: Regresi Linear (Ordinary Least Squares / sklearn LinearRegression)
  -- 6 fitur, PERSIS mengikuti notebook final `Linear_Regression_Sump.ipynb`:
     Curah Hujan, Durasi Hujan, Akumulasi Hujan 3 Hari, Debit Air Limpasan,
     Elevasi Muka Air Sump (hari ini), Delta Elevasi.
DATA SUMBER: `data/Data_Final.xlsx` — data MENTAH harian (9 kolom). Rekayasa
  fitur (Delta Elevasi, Akumulasi Hujan 3 Hari, Target Elevasi Besok)
  dihitung ulang di sini persis seperti di notebook.

PERUBAHAN pada revisi ini (lihat PERUBAHAN.md untuk detail lengkap):
  1. Satuan "meter" pada kartu RMSE/MAE/R² dihapus dari tampilan (nilai polos).
  2. Halaman "Peta Lokasi" dipindah ke urutan kedua sidebar (tepat di bawah
     "Ringkasan Model").
  3. Ditambahkan simulasi status pompa ON/OFF. Karena `Debit Pompa` bernilai
     KONSTAN di seluruh data historis (655.17 m³/jam, pompa selalu menyala
     saat data dikumpulkan), pengaruhnya tidak bisa dipelajari langsung oleh
     model manapun. Simulasi ON/OFF karena itu memakai NERACA AIR sederhana:
     "Debit Air Limpasan" (fitur yang sudah ada di model) dihitung sebagai
     NET FLOW (debit masuk dari limpasan hujan dikurangi debit pompa keluar,
     dikonversi ke m³/detik) saat status pompa ON, dan sebagai debit masuk
     saja (tanpa pengurangan) saat status pompa OFF. Tidak ada fitur baru
     yang ditambahkan ke model -- hanya definisi nilai fitur yang sudah ada
     yang berubah sesuai status pompa. Kedua skenario (ON & OFF) selalu
     dihitung sekaligus di endpoint /api/predict agar dashboard bisa
     menampilkan perbandingan langsung.
  4. Koefisien Limpasan (C) sekarang mengikuti nilai terbaru di data (0.9),
     dibaca otomatis dari `data/Data_Final.xlsx` (tidak di-hardcode).
  5. "Volume Sump" dihapus total (fitur, endpoint, dan kalkulasinya) --
     kolom ini sudah tidak ada lagi di `Data_Final.xlsx` versi ini.
  6. "Intensitas Curah Hujan" sekarang dihitung otomatis (curah ÷ durasi)
     dan ditampilkan di dashboard, sama seperti Debit Air Limpasan.
  7. Parameter input manual TIDAK berubah (tetap Curah Hujan, Durasi Hujan,
     Elevasi Hari Ini, + parameter sensitivitas C & Luas Catchment Area) --
     toggle status pompa bukan input angka baru, hanya saklar ON/OFF.
"""
import os
import joblib
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "model_linear_regression_elevasi_sump.pkl")
FEATURES_PATH = os.path.join(BASE_DIR, "model", "feature_columns.pkl")
DATA_PATH = os.path.join(BASE_DIR, "data", "Data_Final.xlsx")

model = joblib.load(MODEL_PATH)
feature_columns = joblib.load(FEATURES_PATH)
# feature_columns diharapkan persis:
# ["Curah Hujan (mm)", "Durasi Hujan (jam)", "Akumulasi Hujan 3 Hari (mm)",
#  "Debit Air Limpasan (m³/detik)", "Elevasi Muka Air Sump (m)", "Delta Elevasi (m)"]

# ---------------------------------------------------------------------------
# Muat data historis MENTAH, urutkan kronologis
# ---------------------------------------------------------------------------
_df_raw = pd.read_excel(DATA_PATH)
_df_raw["Tanggal"] = pd.to_datetime(_df_raw["Tanggal"])
_df_raw = _df_raw.sort_values("Tanggal").reset_index(drop=True)

# ---------------------------------------------------------------------------
# Rekayasa fitur — PERSIS seperti notebook (Bagian 4: Feature Engineering)
# ---------------------------------------------------------------------------
_df = _df_raw.copy()
_df["Elevasi Muka Air Sump Kemarin (m)"] = _df["Elevasi Muka Air Sump (m)"].shift(1)
_df["Delta Elevasi (m)"] = _df["Elevasi Muka Air Sump (m)"] - _df["Elevasi Muka Air Sump Kemarin (m)"]
_df["Akumulasi Hujan 3 Hari (mm)"] = _df["Curah Hujan (mm)"].rolling(window=3, min_periods=1).sum()
_df["Target_Elevasi_Besok (m)"] = _df["Elevasi Muka Air Sump (m)"].shift(-1)

# Baris yang dipakai model = baris tanpa NaN akibat lag/target (persis notebook)
_df_model = _df.dropna(subset=[
    "Elevasi Muka Air Sump Kemarin (m)",
    "Target_Elevasi_Besok (m)",
]).reset_index(drop=True)


def hitung_intensitas(curah_hujan, durasi_hujan) -> float:
    """Intensitas curah hujan (mm/jam) = curah hujan (mm) / durasi hujan (jam)."""
    if not durasi_hujan or durasi_hujan <= 0:
        return 0.0
    return float(curah_hujan / durasi_hujan)


def hitung_debit_limpasan_masuk(curah_hujan, durasi_hujan, koef_c, luas_km2) -> float:
    """Debit air limpasan MASUK ke sump (Metode Rasional): Q = C x I x A / 3.6
    (Q dalam m³/detik, I = intensitas curah hujan dalam mm/jam)."""
    intensitas = hitung_intensitas(curah_hujan, durasi_hujan)
    return float(koef_c * intensitas * luas_km2 / 3.6)


# --- Konstanta lapangan, dibaca langsung dari data terbaru (tidak di-hardcode) ----
KOEFISIEN_LIMPASAN_DEFAULT = float(_df_raw["Koefisien Limpasan (C)"].iloc[-1])
LUAS_CATCHMENT_DEFAULT = float(_df_raw["Luas Catchment Area (Km²)"].iloc[-1])
DEBIT_POMPA_KONSTAN = float(_df_raw["Debit Pompa (m³/jam)"].iloc[-1])
DEBIT_POMPA_M3_DETIK = DEBIT_POMPA_KONSTAN / 3600.0  # konversi m³/jam -> m³/detik

_elevasi_kemarin_auto = float(_df_raw["Elevasi Muka Air Sump (m)"].iloc[-1])
_curah_hujan_terkini = _df_raw["Curah Hujan (mm)"].tolist()


def hitung_akumulasi_3_hari(curah_hujan_hari_ini: float) -> float:
    """Akumulasi Hujan 3 Hari = curah hujan hari ini + 2 hari sebelumnya
    (persis rolling(window=3, min_periods=1) di notebook -- kalau data
    historis 2 hari sebelumnya tersedia dipakai semua, kalau kurang dari
    2 hari yang tersedia dipakai apa adanya)."""
    n_sebelumnya = _curah_hujan_terkini[-2:] if len(_curah_hujan_terkini) >= 2 else _curah_hujan_terkini[:]
    return float(curah_hujan_hari_ini + sum(n_sebelumnya))


# ---------------------------------------------------------------------------
# Rentang data historis untuk 3 input manual -- dipakai untuk peringatan
# ekstrapolasi (input di luar rentang ini pernah dilihat model saat
# training, sehingga akurasi prediksinya tidak terjamin).
# ---------------------------------------------------------------------------
_RENTANG_INPUT = {
    "curah_hujan": {
        "label": "Curah Hujan",
        "min": float(_df_raw["Curah Hujan (mm)"].min()),
        "max": float(_df_raw["Curah Hujan (mm)"].max()),
        "satuan": "mm",
    },
    "durasi_hujan": {
        "label": "Durasi Hujan",
        "min": float(_df_raw["Durasi Hujan (jam)"].min()),
        "max": float(_df_raw["Durasi Hujan (jam)"].max()),
        "satuan": "jam",
    },
    "elevasi_hari_ini": {
        "label": "Elevasi Hari Ini",
        "min": float(_df_raw["Elevasi Muka Air Sump (m)"].min()),
        "max": float(_df_raw["Elevasi Muka Air Sump (m)"].max()),
        "satuan": "m",
    },
}


def cek_ekstrapolasi(curah_hujan, durasi_hujan, elevasi_hari_ini):
    """Kembalikan daftar peringatan untuk input yang di luar rentang data
    historis (bukan menolak, cuma memberi tahu)."""
    nilai = {
        "curah_hujan": curah_hujan,
        "durasi_hujan": durasi_hujan,
        "elevasi_hari_ini": elevasi_hari_ini,
    }
    peringatan = []
    for key, v in nilai.items():
        r = _RENTANG_INPUT[key]
        if v < r["min"] or v > r["max"]:
            peringatan.append({
                "field": key,
                "label": r["label"],
                "nilai_input": v,
                "rentang_min": r["min"],
                "rentang_max": r["max"],
                "satuan": r["satuan"],
                "pesan": (
                    f"{r['label']} yang Anda masukkan ({v} {r['satuan']}) berada di luar "
                    f"rentang data historis ({r['min']}–{r['max']} {r['satuan']}). "
                    f"Model belum pernah 'belajar' dari kondisi seperti ini, sehingga "
                    f"akurasi prediksi untuk input ini tidak terjamin."
                ),
            })
    return peringatan


# ---------------------------------------------------------------------------
# Evaluasi performa model — PERSIS metodologi notebook final:
# split kronologis 80% latih / 20% uji, evaluasi HANYA di data uji.
# ---------------------------------------------------------------------------
def _evaluasi_model():
    X = _df_model[feature_columns]
    y = _df_model["Target_Elevasi_Besok (m)"]

    split_ratio = 0.8
    split_index = int(len(_df_model) * split_ratio)
    X_test, y_test = X.iloc[split_index:], y.iloc[split_index:]

    y_pred = model.predict(X_test)
    y_true = y_test.values

    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    mae = float(np.mean(np.abs(y_true - y_pred)))
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - y_true.mean()) ** 2)
    r2 = float(1 - ss_res / ss_tot)
    return rmse, mae, r2, len(X_test)


_RMSE, _MAE, _R2, _N_UJI = _evaluasi_model()
_N_TOTAL = len(_df_raw)  # total hari data historis mentah yang terkumpul

# --- Ambang batas status (read-only, lihat Round 6 di PERUBAHAN.md) --------
DEFAULT_KRITIS = -14.0
DEFAULT_WASPADA = -15.0


def tentukan_status(elevasi: float, batas_waspada=DEFAULT_WASPADA, batas_kritis=DEFAULT_KRITIS) -> str:
    if elevasi >= batas_kritis:
        return "kritis"
    if elevasi >= batas_waspada:
        return "waspada"
    return "aman"


# ---------------------------------------------------------------------------
# ROUTES — static frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------------------------------------------------------------------------
# ROUTES — API
# ---------------------------------------------------------------------------
@app.route("/api/model-info", methods=["GET"])
def model_info():
    return jsonify({
        "algoritma": "Linear Regression (OLS)",
        "jumlah_fitur": len(feature_columns),
        "rmse": _RMSE,
        "mae": _MAE,
        "r2": _R2,
        "jumlah_data": _N_TOTAL,
        "jumlah_data_uji": _N_UJI,
    })


@app.route("/api/historical", methods=["GET"])
def historical():
    days = request.args.get("days", default=0, type=int)
    df = _df_raw if days <= 0 else _df_raw.tail(days)
    return jsonify({
        "tanggal": df["Tanggal"].dt.strftime("%Y-%m-%d").tolist(),
        "elevasi": df["Elevasi Muka Air Sump (m)"].round(3).tolist(),
        "curah_hujan": df["Curah Hujan (mm)"].tolist(),
    })


@app.route("/api/constants", methods=["GET"])
def constants():
    return jsonify({
        "koefisien_limpasan": KOEFISIEN_LIMPASAN_DEFAULT,
        "luas_catchment_area": LUAS_CATCHMENT_DEFAULT,
        "debit_pompa": DEBIT_POMPA_KONSTAN,
        "batas_waspada": DEFAULT_WASPADA,
        "batas_kritis": DEFAULT_KRITIS,
    })


@app.route("/api/rentang-input", methods=["GET"])
def rentang_input():
    """Rentang data historis untuk 3 input manual -- dipakai frontend untuk
    menampilkan hint di bawah tiap field form prediksi."""
    return jsonify(_RENTANG_INPUT)


@app.route("/api/feature-importance", methods=["GET"])
def feature_importance():
    """Untuk model linear, 'kepentingan fitur' diukur dari KOEFISIEN
    TERSTANDARISASI: koefisien_i x std(fitur_i). Ini metode standar untuk
    membandingkan pengaruh fitur pada regresi linear secara adil, karena
    tiap fitur skalanya beda-beda (mm vs meter vs m³/detik)."""
    X = _df_model[feature_columns]
    std_per_fitur = X.std()

    items = []
    for f, coef in zip(feature_columns, model.coef_):
        kontribusi_terstandarisasi = float(coef) * float(std_per_fitur[f])
        items.append({
            "fitur": f,
            "koefisien": float(coef),
            "kontribusi_terstandarisasi": kontribusi_terstandarisasi,
        })

    total_abs = sum(abs(it["kontribusi_terstandarisasi"]) for it in items) or 1.0
    for it in items:
        it["importance"] = abs(it["kontribusi_terstandarisasi"]) / total_abs

    items.sort(key=lambda x: x["importance"], reverse=True)
    return jsonify(items)


def _prediksi_dengan_status_pompa(curah_hujan, durasi_hujan, elevasi_hari_ini,
                                   koef_c, luas_a, elevasi_kemarin, akum_3,
                                   pompa_on: bool):
    """Hitung 1 skenario prediksi (pompa ON atau OFF).

    Debit Air Limpasan MASUK (dari limpasan hujan, metode rasional) selalu
    sama. Yang membedakan ON/OFF adalah NILAI BERSIH (net) debit air
    limpasan yang diumpankan ke model:
      - ON  : debit masuk DIKURANGI debit pompa (dikonversi m³/detik)
      - OFF : debit masuk saja (pompa tidak mengeluarkan air)
    """
    debit_masuk = hitung_debit_limpasan_masuk(curah_hujan, durasi_hujan, koef_c, luas_a)
    debit_net = debit_masuk - DEBIT_POMPA_M3_DETIK if pompa_on else debit_masuk
    delta_elevasi = elevasi_hari_ini - elevasi_kemarin

    fitur_values = {
        "Curah Hujan (mm)": curah_hujan,
        "Durasi Hujan (jam)": durasi_hujan,
        "Akumulasi Hujan 3 Hari (mm)": akum_3,
        "Debit Air Limpasan (m³/detik)": debit_net,
        "Elevasi Muka Air Sump (m)": elevasi_hari_ini,
        "Delta Elevasi (m)": delta_elevasi,
    }
    x_row = [fitur_values[col] for col in feature_columns]
    X = pd.DataFrame([x_row], columns=feature_columns)
    prediksi = float(model.predict(X)[0])
    return prediksi, debit_masuk, debit_net, delta_elevasi


@app.route("/api/predict", methods=["POST"])
def predict():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"sukses": False, "error": "Body request harus berupa JSON."}), 400

    wajib = [
        "curah_hujan", "durasi_hujan", "elevasi_hari_ini",
        "koefisien_limpasan", "luas_catchment_area",
    ]
    missing = [f for f in wajib if f not in payload or payload[f] in (None, "")]
    if missing:
        return jsonify({"sukses": False, "error": f"Field berikut belum diisi: {missing}"}), 400

    try:
        curah_hujan = float(payload["curah_hujan"])
        durasi_hujan = float(payload["durasi_hujan"])
        elevasi_hari_ini = float(payload["elevasi_hari_ini"])
        koef_c = float(payload["koefisien_limpasan"])
        luas_a = float(payload["luas_catchment_area"])
    except (TypeError, ValueError):
        return jsonify({"sukses": False, "error": "Semua nilai input harus berupa angka."}), 400

    if not (0.0 <= koef_c <= 1.0):
        return jsonify({"sukses": False, "error": "Koefisien Limpasan (C) harus di antara 0.0 - 1.0."}), 400

    elevasi_kemarin_raw = payload.get("elevasi_kemarin")
    elevasi_kemarin = (
        float(elevasi_kemarin_raw) if elevasi_kemarin_raw not in (None, "")
        else _elevasi_kemarin_auto
    )

    # status_pompa: status yang DIPAKAI sebagai prediksi utama (tangki, status
    # badge, riwayat). Kedua skenario (ON & OFF) tetap dihitung sekaligus di
    # bawah supaya dashboard bisa menampilkan perbandingan langsung.
    status_pompa_raw = payload.get("status_pompa", True)
    status_pompa = bool(status_pompa_raw) and status_pompa_raw not in (False, "false", "off", "0", 0)

    intensitas = hitung_intensitas(curah_hujan, durasi_hujan)
    akum_3 = hitung_akumulasi_3_hari(curah_hujan)

    prediksi_on, debit_masuk, debit_net_on, delta_elevasi = _prediksi_dengan_status_pompa(
        curah_hujan, durasi_hujan, elevasi_hari_ini, koef_c, luas_a,
        elevasi_kemarin, akum_3, pompa_on=True,
    )
    prediksi_off, _, debit_net_off, _ = _prediksi_dengan_status_pompa(
        curah_hujan, durasi_hujan, elevasi_hari_ini, koef_c, luas_a,
        elevasi_kemarin, akum_3, pompa_on=False,
    )

    prediksi_utama = prediksi_on if status_pompa else prediksi_off
    debit_net_utama = debit_net_on if status_pompa else debit_net_off

    batas_waspada = float(payload.get("batas_waspada", DEFAULT_WASPADA))
    batas_kritis = float(payload.get("batas_kritis", DEFAULT_KRITIS))
    status = tentukan_status(prediksi_utama, batas_waspada, batas_kritis)

    peringatan_ekstrapolasi = cek_ekstrapolasi(curah_hujan, durasi_hujan, elevasi_hari_ini)

    return jsonify({
        "sukses": True,
        "status_pompa": status_pompa,
        "prediksi_elevasi_besok": round(prediksi_utama, 3),
        "prediksi_pompa_on": round(prediksi_on, 3),
        "prediksi_pompa_off": round(prediksi_off, 3),
        "elevasi_hari_ini": round(elevasi_hari_ini, 3),
        "elevasi_kemarin_terhitung": round(elevasi_kemarin, 3),
        "delta_elevasi_input": round(delta_elevasi, 3),
        "intensitas_curah_hujan_terhitung": round(intensitas, 4),
        "debit_air_limpasan_masuk_terhitung": round(debit_masuk, 4),
        "debit_air_limpasan_bersih_terhitung": round(debit_net_utama, 4),
        "akumulasi_3_terhitung": round(akum_3, 2),
        "debit_pompa_konstan": DEBIT_POMPA_KONSTAN,
        "status": status,
        "peringatan_ekstrapolasi": peringatan_ekstrapolasi,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
