/* ========================================================================
   SCRIPT DASHBOARD
   File ini menghubungkan halaman (HTML) ke backend Flask (app.py) lewat
   API. Dibagi jadi beberapa bagian sesuai section di halaman:
     1. Ambil & tampilkan metrik performa model
     2. Ambil & tampilkan grafik historis (pakai Chart.js)
     3. Live preview Debit Limpasan & Volume Sump (dihitung di JS, cermin
        dari rumus backend, supaya user lihat perubahan instan saat mengubah
        parameter sensitivitas -- tanpa perlu klik submit dulu)
     4. Kirim form prediksi ke backend, tampilkan hasil di gauge + status
     5. Ambil & tampilkan feature importance
   ======================================================================== */

const API_BASE = ""; // kosong = pakai domain yang sama (Flask menyajikan frontend & API bersamaan)

let historicalChart = null; // referensi objek Chart.js, supaya bisa di-update tanpa dibuat ulang

// ------------------------------------------------------------------------
// BAGIAN 1: Metrik performa model
// ------------------------------------------------------------------------
async function loadModelInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/model-info`);
    const data = await res.json();

    document.getElementById("metric-rmse").textContent = data.rmse.toFixed(4);
    document.getElementById("metric-mae").textContent = data.mae.toFixed(4);
    document.getElementById("metric-r2").textContent = data.r2.toFixed(4);
    document.getElementById("metric-n").textContent = data.jumlah_data;

    document.getElementById("model-pill-text").textContent =
      `${data.algoritma} · R²=${data.r2.toFixed(3)}`;
  } catch (err) {
    document.getElementById("model-pill-text").textContent = "Gagal memuat status model";
    console.error("loadModelInfo error:", err);
  }
}

// ------------------------------------------------------------------------
// BAGIAN 2: Grafik historis (Chart.js)
// ------------------------------------------------------------------------
async function loadHistoricalChart(days = 0) {
  try {
    const url = days > 0
      ? `${API_BASE}/api/historical?days=${days}`
      : `${API_BASE}/api/historical`;
    const res = await fetch(url);
    const data = await res.json();

    const ctx = document.getElementById("historicalChart").getContext("2d");

    if (historicalChart) {
      historicalChart.data.labels = data.tanggal;
      historicalChart.data.datasets[0].data = data.elevasi;
      historicalChart.data.datasets[1].data = data.curah_hujan;
      historicalChart.update();
      return;
    }

    historicalChart = new Chart(ctx, {
      data: {
        labels: data.tanggal,
        datasets: [
          {
            type: "line",
            label: "Elevasi Sump (m)",
            data: data.elevasi,
            borderColor: "#5fb8c4",
            backgroundColor: "rgba(95,184,196,0.08)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: "yElevasi",
          },
          {
            type: "bar",
            label: "Curah Hujan (mm)",
            data: data.curah_hujan,
            backgroundColor: "rgba(217,142,61,0.55)",
            yAxisID: "yHujan",
            barThickness: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#9aa3ab", font: { family: "IBM Plex Mono", size: 11 } },
          },
          tooltip: {
            backgroundColor: "#1b2126",
            borderColor: "#2c343b",
            borderWidth: 1,
            titleFont: { family: "IBM Plex Mono", size: 11 },
            bodyFont: { family: "IBM Plex Mono", size: 11 },
          },
        },
        scales: {
          x: {
            ticks: { color: "#6b747c", maxTicksLimit: 10, font: { size: 10 } },
            grid: { color: "#232a30" },
          },
          yElevasi: {
            position: "left",
            title: { display: true, text: "Elevasi (m)", color: "#9aa3ab", font: { size: 11 } },
            ticks: { color: "#6b747c", font: { size: 10 } },
            grid: { color: "#232a30" },
          },
          yHujan: {
            position: "right",
            title: { display: true, text: "Curah Hujan (mm)", color: "#9aa3ab", font: { size: 11 } },
            ticks: { color: "#6b747c", font: { size: 10 } },
            grid: { display: false },
          },
        },
      },
    });
  } catch (err) {
    console.error("loadHistoricalChart error:", err);
  }
}

document.querySelectorAll(".range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const days = parseInt(btn.dataset.days, 10);
    loadHistoricalChart(days);
  });
});

// ------------------------------------------------------------------------
// BAGIAN 3: Live preview Debit Air Limpasan & Volume Sump
// (rumus ini CERMIN dari backend app.py -- kalau backend diubah, ubah juga di sini)
// ------------------------------------------------------------------------

// Koefisien kurva Volume = f(Elevasi), hasil fit kuadratik dari data historis (R²=0.9998)
const VOL_COEFFS = [3114.43399297, 158864.87494434, 2060859.59270043]; // [a, b, c] utk a*x^2+b*x+c

// Curah hujan 6 hari terakhir dari data historis -- dipakai utk live-preview
// akumulasi 3/5/7 hari (cermin dari hitung_akumulasi() di backend app.py).
let curahHujan6HariTerakhir = [];

async function loadAkumulasiContext() {
  try {
    const res = await fetch(`${API_BASE}/api/akumulasi-context`);
    const data = await res.json();
    curahHujan6HariTerakhir = data.curah_hujan_6_hari_terakhir;
    document.getElementById("akum-context-note").textContent =
      `Data historis terakhir: ${data.tanggal_terakhir}. "Hari Ini" diasumsikan tanggal setelah itu.`;
    updateAkumulasiPreview();
  } catch (err) {
    console.error("loadAkumulasiContext error:", err);
  }
}

function previewAkumulasi(curahHujanHariIni, nHari) {
  const nHariSebelumnya = nHari > 1 ? curahHujan6HariTerakhir.slice(-(nHari - 1)) : [];
  const jumlahSebelumnya = nHariSebelumnya.reduce((a, b) => a + b, 0);
  return curahHujanHariIni + jumlahSebelumnya;
}

function updateAkumulasiPreview() {
  const form = document.getElementById("predict-form");
  const curah = parseFloat(form.curah_hujan.value) || 0;

  document.getElementById("preview-akum-3").textContent = `${formatNumber(previewAkumulasi(curah, 3), 1)} mm`;
  document.getElementById("preview-akum-5").textContent = `${formatNumber(previewAkumulasi(curah, 5), 1)} mm`;
  document.getElementById("preview-akum-7").textContent = `${formatNumber(previewAkumulasi(curah, 7), 1)} mm`;
}

function previewVolumeSump(elevasi) {
  const [a, b, c] = VOL_COEFFS;
  return a * elevasi * elevasi + b * elevasi + c;
}

function previewDebitLimpasan(curahHujan, durasiHujan, koefC, luasA) {
  if (!durasiHujan || durasiHujan <= 0) return 0;
  const intensitas = curahHujan / durasiHujan; // mm/jam
  return (koefC * intensitas * luasA) / 3.6;
}

function formatNumber(n, decimals = 2) {
  return n.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function updateComputedPreview() {
  const form = document.getElementById("predict-form");
  const curah = parseFloat(form.curah_hujan.value) || 0;
  const durasi = parseFloat(form.durasi_hujan.value) || 0;
  const koefC = parseFloat(form.koefisien_limpasan.value) || 0;
  const luasA = parseFloat(form.luas_catchment_area.value) || 0;
  const elevasiHariIni = parseFloat(form.elevasi_hari_ini.value);

  const debit = previewDebitLimpasan(curah, durasi, koefC, luasA);
  document.getElementById("preview-debit").textContent = `${formatNumber(debit, 4)} m³/detik`;

  if (!isNaN(elevasiHariIni)) {
    const volume = previewVolumeSump(elevasiHariIni);
    document.getElementById("preview-volume").textContent = `${formatNumber(volume, 0)} m³`;
  }
}

// Slider Koefisien Limpasan (C) — update label angka + preview
const cSlider = document.getElementById("c-slider");
const cValueLabel = document.getElementById("c-value-label");
cSlider.addEventListener("input", () => {
  cValueLabel.textContent = parseFloat(cSlider.value).toFixed(2);
  updateComputedPreview();
});

// Field-field lain yang memengaruhi preview
["curah_hujan", "durasi_hujan", "luas_catchment_area", "elevasi_hari_ini"].forEach((name) => {
  document.getElementsByName(name)[0].addEventListener("input", updateComputedPreview);
});

// Curah hujan hari ini juga memengaruhi preview akumulasi 3/5/7 hari
document.getElementsByName("curah_hujan")[0].addEventListener("input", updateAkumulasiPreview);

// ------------------------------------------------------------------------
// BAGIAN 4: Form prediksi -> tangki dual (hari ini vs prediksi) + status badge
// ------------------------------------------------------------------------
const TANK_MIN_ELEV = -25.6; // batas bawah tangki (m), dari rentang data historis
const TANK_MAX_ELEV = -14;   // batas atas tangki (m)
const TANK_TOP_Y = 10, TANK_BOTTOM_Y = 200; // koordinat SVG

const STATUS_LABEL = {
  aman: "AMAN",
  waspada: "WASPADA",
  kritis: "KRITIS",
};

// Ikon kecil per status, biar sekali lirik langsung kebaca tanpa perlu baca teks
const STATUS_ICON = {
  aman: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  waspada: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 1 21h22L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17.5" x2="12" y2="17.6"/></svg>',
  kritis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.6"/></svg>',
};

function elevToTankY(elev) {
  const clamped = Math.min(Math.max(elev, TANK_MIN_ELEV), TANK_MAX_ELEV);
  const pct = (clamped - TANK_MIN_ELEV) / (TANK_MAX_ELEV - TANK_MIN_ELEV);
  return TANK_BOTTOM_Y - pct * (TANK_BOTTOM_Y - TANK_TOP_Y);
}

function updateGauge(prediksi, elevasiHariIni, status) {
  document.getElementById("gauge-empty").hidden = true;
  const resultEl = document.getElementById("gauge-result");
  resultEl.hidden = false;

  document.getElementById("gauge-value").textContent = prediksi.toFixed(3);

  const yToday = elevToTankY(elevasiHariIni);
  const yPred = elevToTankY(prediksi);

  const fillToday = document.getElementById("tank-fill-today");
  fillToday.setAttribute("y", yToday);
  fillToday.setAttribute("height", TANK_BOTTOM_Y - yToday);

  const lineToday = document.getElementById("tank-line-today");
  lineToday.setAttribute("y1", yToday);
  lineToday.setAttribute("y2", yToday);

  const linePred = document.getElementById("tank-line-pred");
  linePred.setAttribute("y1", yPred);
  linePred.setAttribute("y2", yPred);

  const deltaPrediksi = prediksi - elevasiHariIni;
  const deltaEl = document.getElementById("gauge-delta");
  if (Math.abs(deltaPrediksi) < 0.02) {
    deltaEl.textContent = "Stabil dari hari ini";
    deltaEl.className = "gauge-delta flat";
  } else if (deltaPrediksi > 0) {
    deltaEl.textContent = `▲ Naik ${deltaPrediksi.toFixed(3)} m dari hari ini`;
    deltaEl.className = "gauge-delta up";
  } else {
    deltaEl.textContent = `▼ Turun ${Math.abs(deltaPrediksi).toFixed(3)} m dari hari ini`;
    deltaEl.className = "gauge-delta down";
  }

  const badgeEl = document.getElementById("status-badge");
  badgeEl.innerHTML = `${STATUS_ICON[status] || ""}<span>${STATUS_LABEL[status] || status}</span>`;
  badgeEl.className = `status-badge status-${status}`;
}

// ------------------------------------------------------------------------
// BAGIAN 4b: Tingkat keyakinan prediksi (dari sebaran pohon Random Forest)
// std_dev_pohon dikirim backend tapi sebelumnya tidak ditampilkan --
// menunjukkan seberapa sepakat pohon-pohon dalam ensemble terhadap prediksi.
// Tidak butuh data tambahan, murni dari model yang sudah ada.
// ------------------------------------------------------------------------
function updateConfidence(stdDevPohon) {
  const el = document.getElementById("gauge-confidence");
  if (stdDevPohon === undefined || stdDevPohon === null) { el.textContent = ""; return; }
  let label;
  if (stdDevPohon < 0.05) label = "Tinggi";
  else if (stdDevPohon < 0.15) label = "Sedang";
  else label = "Rendah";
  el.textContent = `Tingkat keyakinan model: ${label} (σ pohon = ${stdDevPohon.toFixed(3)} m)`;
}

// ------------------------------------------------------------------------
// BAGIAN 4c: Riwayat Prediksi — disimpan di localStorage browser
// ------------------------------------------------------------------------
const RIWAYAT_KEY = "riwayat_prediksi_sump";

function ambilRiwayat() {
  try {
    return JSON.parse(localStorage.getItem(RIWAYAT_KEY)) || [];
  } catch { return []; }
}

function simpanRiwayat(list) {
  localStorage.setItem(RIWAYAT_KEY, JSON.stringify(list));
}

function tambahRiwayat(entry) {
  const list = ambilRiwayat();
  list.unshift(entry); // terbaru di atas
  simpanRiwayat(list.slice(0, 100)); // batasi 100 entri
  renderRiwayat();
}

function hapusEntriRiwayat(idx) {
  const list = ambilRiwayat();
  list.splice(idx, 1);
  simpanRiwayat(list);
  renderRiwayat();
}

function renderRiwayat() {
  const list = ambilRiwayat();
  const emptyEl = document.getElementById("riwayat-empty");
  const listEl = document.getElementById("riwayat-list");
  if (!emptyEl || !listEl) return;

  if (list.length === 0) {
    emptyEl.hidden = false;
    listEl.innerHTML = "";
    return;
  }
  emptyEl.hidden = true;

  listEl.innerHTML = list.map((item, idx) => `
    <div class="riwayat-row">
      <span class="r-tanggal">${item.waktu}</span>
      <span>
        <span class="r-label">Elevasi Hari Ini</span>
        <span class="r-value">${item.elevasiHariIni.toFixed(3)} m</span>
      </span>
      <span>
        <span class="r-label">Prediksi Besok</span>
        <span class="r-value">${item.prediksi.toFixed(3)} m</span>
      </span>
      <span class="r-status status-${item.status}">${STATUS_ICON[item.status] || ""}<span>${STATUS_LABEL[item.status] || item.status}</span></span>
      <button class="r-delete" data-idx="${idx}" title="Hapus entri ini" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </div>
  `).join("");

  listEl.querySelectorAll(".r-delete").forEach((btn) => {
    btn.addEventListener("click", () => hapusEntriRiwayat(parseInt(btn.dataset.idx, 10)));
  });
}

document.getElementById("riwayat-clear-btn")?.addEventListener("click", () => {
  if (confirm("Hapus semua riwayat prediksi?")) {
    simpanRiwayat([]);
    renderRiwayat();
  }
});

function currentThresholds() {
  return {
    batas_waspada: parseFloat(document.getElementById("batas-waspada").value),
    batas_kritis: parseFloat(document.getElementById("batas-kritis").value),
  };
}

document.getElementById("predict-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("form-error");
  errorEl.textContent = "";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  Object.assign(payload, currentThresholds());

  const submitBtn = form.querySelector(".btn-predict");
  submitBtn.disabled = true;
  submitBtn.textContent = "Memprediksi…";

  try {
    const res = await fetch(`${API_BASE}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.sukses) {
      errorEl.textContent = data.error || "Terjadi kesalahan saat memprediksi.";
      return;
    }

    updateGauge(data.prediksi_elevasi_besok, data.elevasi_hari_ini, data.status);
    updateConfidence(data.std_dev_pohon);

    tambahRiwayat({
      waktu: new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }),
      elevasiHariIni: data.elevasi_hari_ini,
      prediksi: data.prediksi_elevasi_besok,
      status: data.status,
    });
  } catch (err) {
    errorEl.textContent = "Tidak bisa terhubung ke server prediksi. Coba lagi sebentar.";
    console.error("predict error:", err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Prediksi Elevasi Besok";
  }
});

// Re-evaluasi status badge kalau ambang batas diubah setelah ada hasil prediksi
["batas-waspada", "batas-kritis"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    const gaugeValueEl = document.getElementById("gauge-value");
    if (document.getElementById("gauge-result").hidden) return;
    const prediksi = parseFloat(gaugeValueEl.textContent);
    const { batas_waspada, batas_kritis } = currentThresholds();
    let status = "aman";
    if (prediksi >= batas_kritis) status = "kritis";
    else if (prediksi >= batas_waspada) status = "waspada";
    const badgeEl = document.getElementById("status-badge");
    badgeEl.textContent = STATUS_LABEL[status];
    badgeEl.className = `status-badge status-${status}`;
  });
});

// ------------------------------------------------------------------------
// BAGIAN 5: Feature importance
// ------------------------------------------------------------------------
async function loadFeatureImportance() {
  try {
    const res = await fetch(`${API_BASE}/api/feature-importance`);
    const data = await res.json();

    const container = document.getElementById("importance-list");
    container.innerHTML = "";

    const maxImportance = Math.max(...data.map((d) => d.importance));

    data.forEach((item) => {
      const row = document.createElement("div");
      row.className = "importance-row";

      const pct = (item.importance / maxImportance) * 100;
      const pctLabel = (item.importance * 100).toFixed(1) + "%";

      row.innerHTML = `
        <span class="fitur-name">${item.fitur}</span>
        <span class="importance-bar-track">
          <span class="importance-bar-fill" style="width:${pct}%"></span>
        </span>
        <span class="pct">${pctLabel}</span>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    console.error("loadFeatureImportance error:", err);
  }
}

// ------------------------------------------------------------------------
// BAGIAN 6: Cover screen — klik untuk masuk ke dashboard
// ------------------------------------------------------------------------
const coverScreen = document.getElementById("cover-screen");
const appShell = document.getElementById("app-shell");

document.getElementById("btn-masuk").addEventListener("click", () => {
  coverScreen.classList.add("cover-hidden");
  appShell.hidden = false;
  setTimeout(() => { coverScreen.hidden = true; }, 550);
});

// ------------------------------------------------------------------------
// BAGIAN 7: Sidebar — navigasi antar halaman (Dashboard/Peta/Riwayat/Profil)
// ------------------------------------------------------------------------
const PAGE_META = {
  dashboard: { title: "Ringkasan Dashboard", sub: "Pemantauan & prediksi elevasi muka air sump secara real-time." },
  peta: { title: "Peta Lokasi Sump", sub: "Denah dan posisi sump di area tambang." },
  riwayat: { title: "Riwayat Prediksi", sub: "Semua prediksi yang pernah dijalankan dari dashboard ini." },
  profil: { title: "Profil", sub: "Identitas pengembang dashboard ini." },
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.page;

    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelector(`.page[data-page="${target}"]`).classList.add("active");

    const meta = PAGE_META[target];
    if (meta) {
      document.getElementById("page-title").textContent = meta.title;
      document.getElementById("page-subtitle").textContent = meta.sub;
    }
  });
});

// ------------------------------------------------------------------------
// BAGIAN 8: Peta Lokasi — pilih gambar dari perangkat, simpan di localStorage
// (biar tetap ada meski halaman di-refresh, tanpa perlu server/upload)
// ------------------------------------------------------------------------
const MAP_IMAGE_KEY = "peta_sump_gambar";

function tampilkanPeta(dataUrl) {
  const imgEl = document.getElementById("map-image");
  const placeholderEl = document.getElementById("map-placeholder");
  if (dataUrl) {
    imgEl.src = dataUrl;
    imgEl.hidden = false;
    placeholderEl.hidden = true;
  } else {
    imgEl.hidden = true;
    placeholderEl.hidden = false;
  }
}

document.getElementById("map-upload-input")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(MAP_IMAGE_KEY, reader.result);
    tampilkanPeta(reader.result);
  };
  reader.readAsDataURL(file);
});

document.getElementById("map-clear-btn")?.addEventListener("click", () => {
  localStorage.removeItem(MAP_IMAGE_KEY);
  tampilkanPeta(null);
});

// ------------------------------------------------------------------------
// INISIALISASI — jalankan semua saat halaman pertama kali dibuka
// ------------------------------------------------------------------------
loadModelInfo();
loadHistoricalChart();
loadFeatureImportance();
loadAkumulasiContext();
updateComputedPreview();
renderRiwayat();
tampilkanPeta(localStorage.getItem(MAP_IMAGE_KEY));
