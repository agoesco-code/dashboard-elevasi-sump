"""
========================================================================
BACKEND - Dashboard Prediksi Elevasi Muka Air Sump Tambang Batubara
========================================================================
Ini adalah "otak" dari website Anda. Tugasnya:
1. Menyediakan API (alamat khusus) yang bisa dipanggil oleh halaman
   web (frontend) untuk mengambil data historis, feature importance,
   dan membuat prediksi baru.
2. Menyajikan halaman HTML frontend itu sendiri.

Struktur alur: Browser -> Flask (app.py ini) -> Model Random Forest
                                              -> Dataset historis
========================================================================
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import pandas as pd
import joblib
import os

# ------------------------------------------------------------------
# BAGIAN 1: Setup awal aplikasi & load model
# ------------------------------------------------------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)  # supaya frontend boleh memanggil API ini dari domain manapun

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

model = joblib.load(os.path.join(BASE_DIR, "model", "model_rf_elevasi_sump.pkl"))
feature_cols = joblib.load(os.path.join(BASE_DIR, "model", "feature_columns.pkl"))

df = pd.read_excel(os.path.join(BASE_DIR, "data", "dataset_final.xlsx"))
df["Tanggal"] = pd.to_datetime(df["Tanggal"])
df = df.sort_values("Tanggal").reset_index(drop=True)

print(f"[STARTUP] Model & data berhasil dimuat. Total {len(df)} baris data historis.")


# ------------------------------------------------------------------
# BAGIAN 2: Halaman utama (menyajikan file index.html)
# ------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def static_files(path):
    # Menyajikan file CSS, JS, dsb dari folder static/
    return send_from_directory(app.static_folder, path)


# ------------------------------------------------------------------
# BAGIAN 3: API - Data historis untuk grafik tren elevasi
# ------------------------------------------------------------------
@app.route("/api/historical")
def get_historical():
    """
    Mengembalikan data historis elevasi sump + curah hujan untuk
    ditampilkan sebagai grafik garis di dashboard.
    Bisa difilter jumlah hari terakhir lewat parameter ?days=90
    """
    days = request.args.get("days", default=None, type=int)

    data = df.copy()
    if days:
        data = data.tail(days)

    result = {
        "tanggal": data["Tanggal"].dt.strftime("%Y-%m-%d").tolist(),
        "elevasi": data["Elevasi Muka Air Sump (m)"].tolist(),
        "curah_hujan": data["Curah Hujan (mm)"].tolist(),
        "volume_sump": data["Volume Sump (m³)"].tolist(),
    }
    return jsonify(result)


# ------------------------------------------------------------------
# BAGIAN 4: API - Feature importance (variabel paling berpengaruh)
# ------------------------------------------------------------------
@app.route("/api/feature-importance")
def get_feature_importance():
    """
    Mengembalikan tingkat kepentingan tiap variabel dalam model,
    diurutkan dari yang paling berpengaruh.
    """
    importance = sorted(
        zip(feature_cols, model.feature_importances_.tolist()),
        key=lambda x: x[1],
        reverse=True,
    )
    result = [{"fitur": f, "importance": round(i, 4)} for f, i in importance]
    return jsonify(result)


# ------------------------------------------------------------------
# BAGIAN 5: API - Info ringkas performa model (untuk ditampilkan di UI)
# ------------------------------------------------------------------
@app.route("/api/model-info")
def get_model_info():
    """
    Info statis tentang performa model, dihitung sebelumnya saat
    training & evaluasi di notebook (RMSE, MAE, R²).
    """
    return jsonify({
        "rmse": 0.7259,
        "mae": 0.3978,
        "r2": 0.9158,
        "jumlah_data": len(df),
        "algoritma": "Random Forest Regressor (n_estimators=200)",
        "target": "Elevasi Muka Air Sump H+1 (besok)",
    })


# ------------------------------------------------------------------
# BAGIAN 6: API - Prediksi elevasi besok (fungsi utama website)
# ------------------------------------------------------------------
@app.route("/api/predict", methods=["POST"])
def predict():
    """
    Menerima data hari ini dari form di website, mengembalikan
    prediksi elevasi besok.

    Contoh body request (JSON) yang dikirim dari frontend:
    {
        "curah_hujan": 25,
        "durasi_hujan": 3.5,
        "akumulasi_3": 40,
        "akumulasi_5": 60,
        "akumulasi_7": 90,
        "debit_limpasan": 15.2,
        "elevasi_kemarin": -15.6,
        "elevasi_hari_ini": -15.3,
        "volume_sump": 341845.32
    }
    """
    try:
        payload = request.get_json()

        elevasi_kemarin = float(payload["elevasi_kemarin"])
        elevasi_hari_ini = float(payload["elevasi_hari_ini"])
        delta_elevasi = elevasi_hari_ini - elevasi_kemarin

        data_baru = pd.DataFrame([{
            "Curah Hujan (mm)": float(payload["curah_hujan"]),
            "Durasi Hujan (jam)": float(payload["durasi_hujan"]),
            "Akumulasi 3 Hari (mm)": float(payload["akumulasi_3"]),
            "Akumulasi 5 Hari (mm)": float(payload["akumulasi_5"]),
            "Akumulasi 7 Hari (mm)": float(payload["akumulasi_7"]),
            "Debit Air Limpasan (m³/detik)": float(payload["debit_limpasan"]),
            "Elevasi Muka Air Sump Kemarin (m)": elevasi_kemarin,
            "Elevasi Muka Air Sump (m)": elevasi_hari_ini,
            "Volume Sump (m³)": float(payload["volume_sump"]),
            "Delta Elevasi (m)": delta_elevasi,
        }])[feature_cols]

        prediksi = float(model.predict(data_baru)[0])

        return jsonify({
            "sukses": True,
            "prediksi_elevasi_besok": round(prediksi, 3),
            "delta_elevasi_input": round(delta_elevasi, 3),
        })

    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"sukses": False, "error": f"Data input tidak valid: {str(e)}"}), 400


# ------------------------------------------------------------------
# BAGIAN 7: Menjalankan server (hanya dipakai saat run lokal)
# ------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
