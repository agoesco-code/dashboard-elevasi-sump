# Dashboard Prediksi Elevasi Muka Air Sump

Website ini adalah output terapan dari penelitian tugas akhir **"Model
Prediktif Elevasi Muka Air Sump Tambang Batubara Menggunakan Algoritma
Random Forest"**. Perusahaan bisa mengakses dashboard ini untuk melihat
tren historis elevasi sump dan memprediksi elevasi H+1 (besok)
berdasarkan kondisi hari ini.

---

## 1. Struktur Project

```
dashboard_sump_web/
├── app.py                  # Backend Flask: API prediksi, data historis, dst
├── requirements.txt        # Daftar library Python yang dibutuhkan
├── model/
│   ├── model_rf_elevasi_sump.pkl   # Model Random Forest yang sudah dilatih
│   └── feature_columns.pkl         # Urutan kolom fitur yang dipakai model
├── data/
│   └── dataset_final.xlsx  # Data historis untuk grafik dashboard
└── static/                 # Frontend (yang dilihat & dipakai user)
    ├── index.html
    ├── style.css
    └── script.js
```

**Cara kerjanya:** `app.py` (backend) menjalankan server yang punya 2 tugas:
1. Menyajikan halaman `index.html` beserta CSS/JS-nya ke browser.
2. Menyediakan "API" — alamat khusus yang dipanggil oleh `script.js` untuk
   mengambil data (grafik historis, feature importance) dan mengirim data
   form ke model untuk diprediksi.

---

## 2. Menjalankan di Komputer Sendiri (Lokal)

```bash
# 1. Masuk ke folder project
cd dashboard_sump_web

# 2. Buat & aktifkan virtual environment
python -m venv venv
.\venv\Scripts\activate      # Windows
# source venv/bin/activate   # Mac/Linux

# 3. Install semua library yang dibutuhkan
pip install -r requirements.txt

# 4. Jalankan server
python app.py
```

Buka browser ke `http://localhost:5000` (bukan `:8501` seperti Streamlit
sebelumnya — Flask pakai port 5000 secara default).

> **Catatan:** kalau di komputer Anda halaman masih tetap kosong seperti
> kejadian sebelumnya dengan Streamlit, itu kemungkinan besar isu
> spesifik ke browser/rendering komputer Anda — **bukan masalah kode
> ini**. Lanjutkan saja ke proses deploy online di bagian 3; berdasarkan
> pengalaman kita sebelumnya, versi online biasanya berjalan normal.

---

## 3. Deploy ke Render (supaya bisa diakses lewat internet)

### Langkah 1 — Upload project ke GitHub

Kalau project ini belum ada di GitHub:

```bash
git init
git add .
git commit -m "Dashboard prediksi elevasi sump - versi awal"
```

Buat repository baru di [github.com/new](https://github.com/new), lalu:

```bash
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git branch -M main
git push -u origin main
```

### Langkah 2 — Buat Web Service di Render

1. Buka [render.com](https://render.com), login (bisa pakai akun GitHub).
2. Klik **New +** → **Web Service**.
3. Pilih repository GitHub Anda yang berisi project ini.
4. Isi konfigurasi:
   - **Name**: bebas, misal `dashboard-elevasi-sump`
   - **Region**: pilih yang terdekat (Singapore biasanya paling dekat ke Indonesia)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
   - **Instance Type**: `Free`
5. Klik **Create Web Service**.

Render akan otomatis install semua library dari `requirements.txt` dan
menjalankan server. Proses ini biasanya 2–5 menit — Anda bisa pantau
progressnya di tab **Logs**.

### Langkah 3 — Selesai

Setelah deploy berhasil (statusnya jadi **Live**), Render akan memberi
Anda link seperti:

```
https://dashboard-elevasi-sump.onrender.com
```

**Inilah link yang bisa Anda berikan ke perusahaan.**

> **Catatan tentang free tier Render:** kalau tidak ada yang mengakses
> selama ±15 menit, server akan "tidur" otomatis untuk menghemat sumber
> daya. Akses pertama setelah itu akan terasa lambat (30–60 detik)
> sebelum server "bangun" lagi — ini normal, bukan error.

### Update di kemudian hari

Setiap kali Anda mengubah kode dan ingin memperbarui website yang sudah
online, cukup:

```bash
git add .
git commit -m "deskripsi perubahan"
git push
```

Render akan otomatis mendeteksi push baru dan re-deploy sendiri.

---

## 4. Penjelasan Tiap Bagian Dashboard

| Section di halaman | Fungsi | Sumber data |
|---|---|---|
| 1. Ringkasan Performa Model | Menampilkan RMSE, MAE, R² model | `/api/model-info` |
| 2. Tren Historis Elevasi Sump | Grafik elevasi & curah hujan dari waktu ke waktu | `/api/historical` |
| 3. Prediksi Elevasi Besok | Form input kondisi hari ini → hasil prediksi | `/api/predict` (POST) |
| 4. Variabel Paling Berpengaruh | Bar chart feature importance model | `/api/feature-importance` |

---

## 5. Model yang Digunakan

- **Algoritma**: Random Forest Regressor (`n_estimators=200`, parameter lain default)
- **Target**: Elevasi Muka Air Sump H+1 (besok)
- **Fitur input** (10): Curah Hujan, Durasi Hujan, Akumulasi 3/5/7 Hari, Debit
  Air Limpasan, Elevasi Kemarin, Elevasi Hari Ini, Volume Sump, Delta Elevasi
- **Performa** (data uji, 15% data terakhir secara kronologis):
  RMSE = 0.7259 m · MAE = 0.3978 m · R² = 0.9158
