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
├── app.py                  <- tidak berubah di round 2 (logika & endpoint tetap sama)
├── requirements.txt        <- tidak berubah
└── static/
    ├── index.html          <- direstruktur: tambah cover, sidebar, 4 halaman (dashboard/peta/riwayat/profil)
    ├── script.js           <- tambah navigasi halaman, ikon status, confidence, riwayat, upload peta
    ├── style.css            <- tambah style cover, sidebar, background animasi, halaman baru
    └── logo.svg             <- BARU, logo resmi dashboard (juga dipakai sebagai favicon)
```

## Revisi Tampilan (Round 2)

| # | Permintaan | Yang Dilakukan |
|---|---|---|
| 1 | Peta/denah lokasi sump | Halaman **Peta Lokasi** baru — placeholder rapi + tombol pilih gambar dari perangkat (tersimpan di browser lewat localStorage), tinggal upload gambar peta kapan pun sudah ada |
| 2 | Kartu status pakai ikon, bukan cuma teks | Badge status sekarang pakai ikon centang (Aman), segitiga (Waspada), lingkaran seru (Kritis) di samping teksnya |
| 3 | Tangki dual lebih simpel, ada info "Perubahan" | Sudah ada dari versi sebelumnya (garis solid = hari ini, putus-putus = prediksi besok) — dipertahankan, ditambah info **tingkat keyakinan model** (dari sebaran pohon Random Forest, fitur `std_dev_pohon` yang sebelumnya dihitung tapi tidak ditampilkan) |
| 4 | Sidebar navigasi di kiri | Sidebar baru dengan 4 menu: Dashboard, Peta Lokasi, Riwayat Prediksi, Profil — masing-masing dengan ikon |
| 5 | Background dipercantik, ada gerakannya | Ditambah lapisan SVG "blob" yang bergerak pelan (animasi CSS) di halaman cover & di belakang konten, warna tetap memakai palet amber/cyan yang sudah ada |
| 6 | Riwayat prediksi sebelumnya | Halaman **Riwayat Prediksi** baru — setiap kali klik "Prediksi Elevasi Besok", hasilnya otomatis tercatat (tersimpan di browser), bisa dihapus per-baris atau semua |
| 7 | Cover/halaman awal yang bisa diklik | Layar pembuka baru dengan judul dashboard, logo, dan tombol "Masuk ke Dashboard" |
| 8 | Halaman identitas pemilik | Halaman **Profil** baru berisi nama, NPM, jurusan, dan universitas |
| 9 | Logo resmi | Logo baru (`static/logo.svg`) — ikon gelas berisi air, dipakai sebagai favicon, di sidebar, cover, dan halaman profil |

Semua fitur di atas dikerjakan tanpa perlu data tambahan (murni frontend
+ 1 field yang sudah dikirim backend tapi belum ditampilkan). Peta lokasi
sengaja dibuat sebagai placeholder yang bisa diisi gambar kapan saja lewat
tombol upload — tidak perlu edit kode lagi begitu ada gambarnya.

## Cara Update ke PythonAnywhere

1. Upload/timpa semua file di atas ke repo GitHub Anda
   (`agoesco-code/dashboard-elevasi-sump`)
2. Di konsol Bash PythonAnywhere, masuk ke folder project lalu:
   ```
   git pull origin main
   ```
3. Buka tab **Web** di PythonAnywhere, klik tombol **Reload**
4. Buka `prediksisump.pythonanywhere.com`, hard refresh (Ctrl+Shift+R)
