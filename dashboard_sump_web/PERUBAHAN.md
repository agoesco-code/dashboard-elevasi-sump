# Update Dashboard — Perbaikan & Fitur Baru

File ini menjelaskan apa yang berubah dari versi dashboard Anda sebelumnya
(yang sudah online di PythonAnywhere), supaya mudah dibandingkan.

## Ringkasan Perubahan

| # | Permintaan | Yang Dilakukan |
|---|---|---|
| 1-4 | Curah hujan, durasi hujan, elevasi kemarin, elevasi hari ini tetap manual | Tidak berubah, sudah sesuai — tetap 4 input manual ini di form |
| 5 | Koefisien Limpasan (C) sebagai parameter sensitivitas 0.0–1.0 | Ditambahkan sebagai **slider** dengan label angka real-time |
| 6 | Luas Catchment Area (km²) sebagai parameter sensitivitas | Ditambahkan sebagai input angka, default 3.66 sesuai data Anda |
| 7 | Debit Air Limpasan otomatis dari curah & durasi hujan | Dihitung otomatis pakai **Metode Rasional**: `Q = C × I × A / 3.6` |
| 8 | Volume Sump otomatis dari data elevasi | Dihitung otomatis pakai **regresi kuadratik** hasil fit dari 545 data historis Anda (R² = 0.9998) |
| 9 | Status Aman/Waspada/Kritis, ambang batas di -14 | Ditambahkan badge status berwarna, kritis default di -14 m, waspada di -15 m (bisa diatur) |
| 10 | Akumulasi 3/5/7 hari — buang atau jelaskan | Dipindah ke bagian **"Lanjutan"** (collapsible), diberi penjelasan pengaruhnya kecil (<1.5%), diestimasi otomatis kalau dikosongkan |

**Bonus:** Bug batang warna di "Variabel Paling Berpengaruh" yang sebelumnya
tidak muncul (cuma garis abu-abu) — sudah diperbaiki (kurang `display: block`
di CSS-nya).

## Penjelasan Formula yang Dipakai

### Debit Air Limpasan (Metode Rasional)

```
Q = C × I × A / 3.6

Q = debit air limpasan (m³/detik)
C = koefisien limpasan (0.0 - 1.0)
I = intensitas curah hujan (mm/jam) = curah_hujan ÷ durasi_hujan
A = luas catchment area (km²)
```

Formula ini dicocokkan dengan data Excel Anda dan akurasinya >99.9%.

### Volume Sump (Regresi Kuadratik)

```
Volume = 3114.434 × Elevasi² + 158864.875 × Elevasi + 2060859.593
```

Koefisien ini didapat dari `numpy.polyfit(elevasi, volume, deg=2)` terhadap
545 baris data historis Anda. R² = 0.9998, artinya kurva ini menjelaskan
99.98% variasi Volume Sump berdasarkan Elevasi — sangat akurat karena
Volume Sump memang murni fungsi dari bentuk cekungan sump di elevasi
tertentu.

### Status Aman / Waspada / Kritis

Dihitung dari **elevasi hasil prediksi** (bukan elevasi hari ini) — jadi
sifatnya prediktif/early-warning:

```
Kritis   : prediksi >= -14 m  (default)
Waspada  : -15 m <= prediksi < -14 m
Aman     : prediksi < -15 m
```

Kedua ambang batas ini bisa diubah langsung di dashboard (bagian "Atur
ambang batas status").

## File yang Berubah

```
dashboard_sump_web/
├── app.py                  <- ditulis ulang total (endpoint baru + kalkulasi otomatis)
├── requirements.txt        <- ditambah 'openpyxl' (untuk baca file Excel)
└── static/
    ├── index.html          <- form direvisi, tambah section sensitivitas & status
    ├── script.js           <- tambah live preview & logika status badge
    └── style.css            <- tambah style elemen baru + perbaikan bug bar
```

## Cara Update ke PythonAnywhere

1. Upload/timpa semua file di atas ke repo GitHub Anda
   (`agoesco-code/dashboard-elevasi-sump`)
2. Di konsol Bash PythonAnywhere, masuk ke folder project lalu:
   ```
   git pull origin main
   ```
3. Buka tab **Web** di PythonAnywhere, klik tombol **Reload**
4. Buka `prediksisump.pythonanywhere.com`, hard refresh (Ctrl+Shift+R)
