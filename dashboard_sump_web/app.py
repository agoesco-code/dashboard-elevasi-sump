"""
Backend API — Dashboard Prediksi Elevasi Muka Air Sump
=========================================================
Endpoint yang dipakai oleh static/script.js:
  GET  /api/model-info          -> metrik performa model (RMSE, MAE, R², jumlah data)
  GET  /api/historical          -> data historis untuk grafik tren
  GET  /api/constants           -> konstanta lapangan (C, Luas) & ambang batas status
  GET  /api/rentang-input       -> rentang data historis (hint & peringatan ekstrapolasi)
  GET  /api/konteks-otomatis    -> data terakhir untuk hitung otomatis Akumulasi 3 Hari & Delta Elevasi
  GET  /api/feature-importance  -> kontribusi tiap fitur ke prediksi
  POST /api/predict             -> prediksi elevasi muka air sump besok

MODEL: Linear Regression (OLS), 6 fitur persis notebook final:
  Curah Hujan, Durasi Hujan, Akumulasi Hujan 3 Hari, Debit Air Limpasan,
  Elevasi Muka Air Sump (hari ini), Delta Elevasi.
DATA: data/Data_Final.xlsx. "Data historis" yang dipakai model = baris yang
  punya Elevasi Kemarin & Target Elevasi Besok (577 baris mentah -> 575).

REVISI TERBARU: semua fitur pompa dihapus (angka Debit Pompa, simulasi ON/OFF,
  neraca air & tabel volume). Prediksi kembali murni dari model regresi.
  Intensitas Curah Hujan tidak lagi ditampilkan (tetap dipakai internal untuk
  menghitung Debit Air Limpasan). Akumulasi Hujan 3 Hari & Delta Elevasi
  dihitung otomatis dan ditampilkan.
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


def hitung_debit_limpasan(curah_hujan, durasi_hujan, koef_c, luas_km2) -> float:
    """Debit air limpasan (Metode Rasional): Q = C x I x A / 3.6
    (Q dalam m³/detik, I = intensitas curah hujan dalam mm/jam)."""
    intensitas = hitung_intensitas(curah_hujan, durasi_hujan)
    return float(koef_c * intensitas * luas_km2 / 3.6)


# --- Konstanta lapangan, dibaca langsung dari data terbaru (tidak di-hardcode) ----
KOEFISIEN_LIMPASAN_DEFAULT = float(_df_raw["Koefisien Limpasan (C)"].iloc[-1])
LUAS_CATCHMENT_DEFAULT = float(_df_raw["Luas Catchment Area (Km²)"].iloc[-1])

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
_N_TOTAL = len(_df_model)  # data historis yang dipakai model (mis. 577 mentah -> 575)
_N_MENTAH = len(_df_raw)

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
        "jumlah_data_mentah": _N_MENTAH,
        "jumlah_data_uji": _N_UJI,
    })


@app.route("/api/historical", methods=["GET"])
def historical():
    days = request.args.get("days", default=0, type=int)
    df = _df_model if days <= 0 else _df_model.tail(days)
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
        "batas_waspada": DEFAULT_WASPADA,
        "batas_kritis": DEFAULT_KRITIS,
    })


@app.route("/api/rentang-input", methods=["GET"])
def rentang_input():
    """Rentang data historis untuk 3 input manual -- dipakai frontend untuk
    menampilkan hint di bawah tiap field form prediksi."""
    return jsonify(_RENTANG_INPUT)


@app.route("/api/konteks-otomatis", methods=["GET"])
def konteks_otomatis():
    """Data terakhir dari histori, supaya frontend bisa menampilkan
    Akumulasi Hujan 3 Hari & Delta Elevasi secara otomatis."""
    return jsonify({
        "elevasi_kemarin": _elevasi_kemarin_auto,
        "curah_hujan_2_hari_terakhir": float(sum(_curah_hujan_terkini[-2:])),
        "tanggal_data_terakhir": _df_raw["Tanggal"].iloc[-1].strftime("%Y-%m-%d"),
    })


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


@app.route("/api/predict", methods=["POST"])
def predict():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"sukses": False, "error": "Body request harus berupa JSON."}), 400

    wajib = ["curah_hujan", "durasi_hujan", "elevasi_hari_ini",
             "koefisien_limpasan", "luas_catchment_area"]
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

    # Fitur otomatis: Debit Air Limpasan, Akumulasi 3 Hari, Delta Elevasi
    debit_limpasan = hitung_debit_limpasan(curah_hujan, durasi_hujan, koef_c, luas_a)
    akum_3 = hitung_akumulasi_3_hari(curah_hujan)
    delta_elevasi = elevasi_hari_ini - _elevasi_kemarin_auto

    nilai_fitur = {
        "Curah Hujan (mm)": curah_hujan,
        "Durasi Hujan (jam)": durasi_hujan,
        "Akumulasi Hujan 3 Hari (mm)": akum_3,
        "Debit Air Limpasan (m³/detik)": debit_limpasan,
        "Elevasi Muka Air Sump (m)": elevasi_hari_ini,
        "Delta Elevasi (m)": delta_elevasi,
    }
    try:
        X = pd.DataFrame([[nilai_fitur[f] for f in feature_columns]], columns=feature_columns)
    except KeyError as e:
        return jsonify({"sukses": False, "error": f"Kolom fitur model tidak dikenali: {e}"}), 500

    prediksi = float(model.predict(X)[0])
    status = tentukan_status(prediksi)

    return jsonify({
        "sukses": True,
        "prediksi_elevasi_besok": round(prediksi, 3),
        "elevasi_hari_ini": round(elevasi_hari_ini, 3),
        "debit_air_limpasan_terhitung": round(debit_limpasan, 4),
        "akumulasi_3_terhitung": round(akum_3, 2),
        "delta_elevasi_terhitung": round(delta_elevasi, 3),
        "status": status,
        "peringatan_ekstrapolasi": cek_ekstrapolasi(curah_hujan, durasi_hujan, elevasi_hari_ini),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
