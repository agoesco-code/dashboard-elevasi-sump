"""
Backend API — Dashboard Prediksi Elevasi Muka Air Sump
=========================================================

Menyediakan endpoint yang dipakai oleh static/script.js:
  GET  /api/model-info          -> metrik performa model (RMSE, MAE, R², dsb)
  GET  /api/historical          -> data historis untuk grafik tren
  GET  /api/akumulasi-context   -> curah hujan terakhir (live-preview akumulasi)
  GET  /api/constants           -> nilai konstanta lapangan
  GET  /api/feature-importance  -> kontribusi tiap fitur ke prediksi
  POST /api/predict             -> prediksi elevasi besok

MODEL: Regresi Linear (Ordinary Least Squares / sklearn LinearRegression)
  -- model & pipeline persis mengikuti notebook `Eksplorasi_data.ipynb`.
DATA SUMBER: `data/Data_Final.xlsx` — data MENTAH harian (10 kolom), BELUM
  direkayasa. Rekayasa fitur (Elevasi Kemarin, Delta Elevasi, Akumulasi
  3/5/7 Hari, Target Elevasi Besok) dihitung ulang di sini persis seperti
  di notebook, supaya hasilnya konsisten dengan yang sudah dievaluasi.

PERUBAHAN dari versi Random Forest sebelumnya:
  - Model diganti total ke Linear Regression (lihat model/model_linear_regression_elevasi_sump.pkl).
  - "Feature Importance" (feature_importances_, khusus model berbasis pohon)
    diganti dengan KOEFISIEN TERSTANDARISASI (coef_ x std tiap fitur) —
    metode yang tepat untuk mengukur & membandingkan kontribusi fitur pada
    model linear, karena skala satuan tiap fitur berbeda-beda.
  - "Tingkat keyakinan per-prediksi" (std_dev_pohon, dari sebaran pohon RF)
    dihapus karena Linear Regression tidak punya ensemble. Sebagai gantinya
    ditampilkan RMSE data uji sebagai estimasi margin error tipikal (nilai
    tetap, bukan per-prediksi).
  - RMSE/MAE/R² dihitung PERSIS seperti notebook: split kronologis 85%
    data latih / 15% data uji, dievaluasi HANYA pada data uji (bukan
    seluruh dataset), supaya angkanya sama dengan yang divalidasi di
    notebook.
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
_df["Akumulasi 3 Hari (mm)"] = _df["Curah Hujan (mm)"].rolling(window=3, min_periods=3).sum()
_df["Akumulasi 5 Hari (mm)"] = _df["Curah Hujan (mm)"].rolling(window=5, min_periods=5).sum()
_df["Akumulasi 7 Hari (mm)"] = _df["Curah Hujan (mm)"].rolling(window=7, min_periods=7).sum()
_df["Target_Elevasi_Besok (m)"] = _df["Elevasi Muka Air Sump (m)"].shift(-1)

# Baris yang dipakai model = baris tanpa NaN akibat lag/rolling/target
# (persis notebook Bagian 4.5)
_df_model = _df.dropna(subset=[
    "Elevasi Muka Air Sump Kemarin (m)",
    "Akumulasi 7 Hari (mm)",
    "Target_Elevasi_Besok (m)",
]).reset_index(drop=True)

# --- Fit kurva Volume Sump = f(Elevasi) dari data historis (kuadratik) -----
# (murni hubungan geometris cekungan sump, dipakai untuk auto-estimasi
# Volume Sump dari input Elevasi Hari Ini pengguna)
_vol_coeffs = np.polyfit(
    _df_raw["Elevasi Muka Air Sump (m)"], _df_raw["Volume Sump (m³)"], deg=2
)

def hitung_volume_sump(elevasi_m: float) -> float:
    return float(np.polyval(_vol_coeffs, elevasi_m))


def hitung_debit_limpasan(curah_hujan, durasi_hujan, koef_c, luas_km2) -> float:
    """Metode Rasional: Q (m³/detik) = C x I x A / 3.6, I = curah/durasi (mm/jam)."""
    if not durasi_hujan or durasi_hujan <= 0:
        return 0.0
    intensitas = curah_hujan / durasi_hujan
    return float(koef_c * intensitas * luas_km2 / 3.6)


# --- Curah hujan historis (urut lama -> baru), dipakai untuk akumulasi -----
_curah_hujan_terkini = _df_raw["Curah Hujan (mm)"].tolist()


def hitung_akumulasi(curah_hujan_hari_ini: float, n_hari: int) -> float:
    n_hari_sebelumnya = _curah_hujan_terkini[-(n_hari - 1):] if n_hari > 1 else []
    return float(curah_hujan_hari_ini + sum(n_hari_sebelumnya))


_elevasi_kemarin_auto = float(_df_raw["Elevasi Muka Air Sump (m)"].iloc[-1])

# ---------------------------------------------------------------------------
# Evaluasi performa model — PERSIS metodologi notebook:
# split kronologis 85% latih / 15% uji, evaluasi HANYA di data uji.
# ---------------------------------------------------------------------------
def _evaluasi_model():
    X = _df_model[feature_columns]
    y = _df_model["Target_Elevasi_Besok (m)"]

    split_ratio = 0.85
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

# --- Ambang batas status ----------------------------------------------------
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


@app.route("/api/akumulasi-context", methods=["GET"])
def akumulasi_context():
    return jsonify({
        "curah_hujan_6_hari_terakhir": _curah_hujan_terkini[-6:],
        "tanggal_terakhir": _df_raw["Tanggal"].max().strftime("%Y-%m-%d"),
    })


@app.route("/api/constants", methods=["GET"])
def constants():
    return jsonify({
        "koefisien_limpasan": float(_df_raw["Koefisien Limpasan ( C )"].iloc[-1]),
        "luas_catchment_area": float(_df_raw["Luas Catchment Area ( Km² )"].iloc[-1]),
        "debit_pompa": float(_df_raw["Debit Pompa ( m³/jam )"].iloc[-1]),
    })


@app.route("/api/feature-importance", methods=["GET"])
def feature_importance():
    """Untuk model linear, 'kepentingan fitur' diukur dari KOEFISIEN
    TERSTANDARISASI: koefisien_i x std(fitur_i). Ini metode standar untuk
    membandingkan pengaruh fitur pada regresi linear secara adil, karena
    tiap fitur skalanya beda-beda (mm vs meter vs m³ vs m³/detik)."""
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

    elevasi_kemarin_raw = payload.get("elevasi_kemarin")
    elevasi_kemarin = (
        float(elevasi_kemarin_raw) if elevasi_kemarin_raw not in (None, "")
        else _elevasi_kemarin_auto
    )

    if not (0.0 <= koef_c <= 1.0):
        return jsonify({"sukses": False, "error": "Koefisien Limpasan (C) harus di antara 0.0 - 1.0."}), 400

    def _get_or_hitung(key, n_hari):
        val = payload.get(key)
        if val in (None, ""):
            return hitung_akumulasi(curah_hujan, n_hari)
        return float(val)

    akum_3 = _get_or_hitung("akumulasi_3", 3)
    akum_5 = _get_or_hitung("akumulasi_5", 5)
    akum_7 = _get_or_hitung("akumulasi_7", 7)

    debit_limpasan = hitung_debit_limpasan(curah_hujan, durasi_hujan, koef_c, luas_a)
    volume_sump = hitung_volume_sump(elevasi_hari_ini)
    delta_elevasi = elevasi_hari_ini - elevasi_kemarin

    fitur_values = {
        "Curah Hujan (mm)": curah_hujan,
        "Durasi Hujan (jam)": durasi_hujan,
        "Akumulasi 3 Hari (mm)": akum_3,
        "Akumulasi 5 Hari (mm)": akum_5,
        "Akumulasi 7 Hari (mm)": akum_7,
        "Debit Air Limpasan (m³/detik)": debit_limpasan,
        "Elevasi Muka Air Sump Kemarin (m)": elevasi_kemarin,
        "Elevasi Muka Air Sump (m)": elevasi_hari_ini,
        "Volume Sump (m³)": volume_sump,
        "Delta Elevasi (m)": delta_elevasi,
    }

    try:
        x_row = [fitur_values[col] for col in feature_columns]
    except KeyError as e:
        return jsonify({"sukses": False, "error": f"Kolom fitur model tidak dikenali: {e}"}), 500

    X = pd.DataFrame([x_row], columns=feature_columns)
    prediksi = float(model.predict(X)[0])

    batas_waspada = float(payload.get("batas_waspada", DEFAULT_WASPADA))
    batas_kritis = float(payload.get("batas_kritis", DEFAULT_KRITIS))
    status = tentukan_status(prediksi, batas_waspada, batas_kritis)

    return jsonify({
        "sukses": True,
        "prediksi_elevasi_besok": round(prediksi, 3),
        "elevasi_hari_ini": round(elevasi_hari_ini, 3),
        "elevasi_kemarin_terhitung": round(elevasi_kemarin, 3),
        "delta_elevasi_input": round(delta_elevasi, 3),
        "debit_air_limpasan_terhitung": round(debit_limpasan, 4),
        "volume_sump_terhitung": round(volume_sump, 2),
        "akumulasi_3_terhitung": round(akum_3, 2),
        "akumulasi_5_terhitung": round(akum_5, 2),
        "akumulasi_7_terhitung": round(akum_7, 2),
        "status": status,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
