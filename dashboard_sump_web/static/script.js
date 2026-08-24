/* ========================================================================
   SCRIPT DASHBOARD
   File ini menghubungkan halaman (HTML) ke backend Flask (app.py) lewat
   API. Dibagi jadi beberapa bagian sesuai section/halaman:
     1. Metrik performa model + slide-over drawer detail
     2. Grafik historis (Chart.js)
     3. Live preview Debit Limpasan & Volume Sump + Konstanta Lapangan
     4. Form prediksi -> tangki dual + status badge + loading spinner
     5. Feature importance
     6. Cover screen
     7. Sidebar (navigasi 7 halaman)
     8. Peta lokasi (zoom & pan)
     9. Riwayat prediksi (localStorage)
     10. Animasi latar hujan
   ======================================================================== */

const API_BASE = ""; // kosong = pakai domain yang sama (Flask menyajikan frontend & API bersamaan)

let historicalChart = null;

// ------------------------------------------------------------------------
// BAGIAN 1: Metrik performa model + drawer detail
// ------------------------------------------------------------------------
const METRIC_INFO = {
  rmse: {
    title: "RMSE",
    unit: "meter",
    desc: "Root Mean Squared Error — rata-rata besar kesalahan prediksi dalam satuan meter, dihitung dari akar rata-rata kuadrat selisih antara prediksi dan nilai aktual. RMSE memberi bobot lebih besar pada kesalahan yang besar, sehingga bagus untuk mendeteksi apakah model pernah meleset jauh.",
  },
  mae: {
    title: "MAE",
    unit: "meter",
    desc: "Mean Absolute Error — rata-rata selisih absolut antara prediksi dan nilai aktual, dalam satuan meter. Lebih mudah dibaca sebagai \u201crata-rata meleset berapa meter\u201d dibanding RMSE, karena tidak memberi bobot ekstra pada kesalahan besar.",
  },
  r2: {
    title: "R² (Koefisien Determinasi)",
    unit: "",
    desc: "Mengukur seberapa besar variasi elevasi besok yang berhasil dijelaskan oleh model, dalam skala 0 sampai 1. Semakin dekat ke 1, semakin baik model menangkap pola pada data historis.",
  },
  n: {
    title: "Jumlah Data Historis",
    unit: "hari",
    desc: "Jumlah hari data historis yang dipakai untuk melatih & mengevaluasi model ini. Semakin banyak & semakin representatif datanya, semakin bisa diandalkan model terhadap kondisi lapangan yang sebenarnya.",
  },
};

let _modelMetrics = {};

async function loadModelInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/model-info`);
    const data = await res.json();
    _modelMetrics = data;

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

const METRIC_VALUE_KEY = { rmse: "rmse", mae: "mae", r2: "r2", n: "jumlah_data" };

function openDrawer(metricKey) {
  const info = METRIC_INFO[metricKey];
  if (!info) return;
  const valKey = METRIC_VALUE_KEY[metricKey];
  const raw = _modelMetrics[valKey];
  const displayVal = typeof raw === "number"
    ? (metricKey === "n" ? raw : raw.toFixed(4))
    : "–";

  document.getElementById("drawer-title").textContent = info.title;
  document.getElementById("drawer-value").textContent = info.unit ? `${displayVal} ${info.unit}` : displayVal;
  document.getElementById("drawer-desc").textContent = info.desc;

  document.getElementById("drawer-panel").classList.add("open");
  document.getElementById("drawer-panel").setAttribute("aria-hidden", "false");
  document.getElementById("drawer-backdrop").classList.add("open");
}

function closeDrawer() {
  document.getElementById("drawer-panel").classList.remove("open");
  document.getElementById("drawer-panel").setAttribute("aria-hidden", "true");
  document.getElementById("drawer-backdrop").classList.remove("open");
}

document.querySelectorAll(".metric-card").forEach((card) => {
  card.addEventListener("click", () => openDrawer(card.dataset.metric));
});
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

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

    const canvasEl = document.getElementById("historicalChart");
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");

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
          legend: { labels: { color: "#9aa3ab", font: { family: "IBM Plex Mono", size: 11 } } },
          tooltip: {
            backgroundColor: "#1b2126",
            borderColor: "#2c343b",
            borderWidth: 1,
            titleFont: { family: "IBM Plex Mono", size: 11 },
            bodyFont: { family: "IBM Plex Mono", size: 11 },
          },
        },
        scales: {
          x: { ticks: { color: "#6b747c", maxTicksLimit: 10, font: { size: 10 } }, grid: { color: "#232a30" } },
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
    loadHistoricalChart(parseInt(btn.dataset.days, 10));
  });
});

// ------------------------------------------------------------------------
// BAGIAN 3: Live preview Debit Air Limpasan & Volume Sump + Konstanta
// (rumus ini CERMIN dari backend app.py -- kalau backend diubah, ubah juga di sini)
// ------------------------------------------------------------------------
const VOL_COEFFS = [3114.43399297, 158864.87494434, 2060859.59270043]; // [a, b, c] utk a*x^2+b*x+c

async function loadConstants() {
  try {
    const res = await fetch(`${API_BASE}/api/constants`);
    const data = await res.json();

    document.getElementById("const-c").textContent = data.koefisien_limpasan.toFixed(2);
    document.getElementById("const-luas").textContent = `${data.luas_catchment_area} km²`;
    document.getElementById("const-pompa").textContent = `${data.debit_pompa} m³/jam`;

    // Set nilai default slider/field sensitivitas mengikuti konstanta lapangan asli
    const cSlider = document.getElementById("c-slider");
    const cLabel = document.getElementById("c-value-label");
    const luasInput = document.getElementById("luas-input");
    if (cSlider) { cSlider.value = data.koefisien_limpasan; cLabel.textContent = data.koefisien_limpasan.toFixed(2); }
    if (luasInput) luasInput.value = data.luas_catchment_area;

    updateComputedPreview();
  } catch (err) {
    console.error("loadConstants error:", err);
  }
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

const cSlider = document.getElementById("c-slider");
const cValueLabel = document.getElementById("c-value-label");
cSlider.addEventListener("input", () => {
  cValueLabel.textContent = parseFloat(cSlider.value).toFixed(2);
  updateComputedPreview();
});

["curah_hujan", "durasi_hujan", "luas_catchment_area", "elevasi_hari_ini"].forEach((name) => {
  document.getElementsByName(name)[0].addEventListener("input", updateComputedPreview);
});

// ------------------------------------------------------------------------
// BAGIAN 4: Form prediksi -> tangki dual (hari ini vs prediksi) + status badge
// ------------------------------------------------------------------------
const TANK_MIN_ELEV = -25.6;
const TANK_MAX_ELEV = -14;
const TANK_TOP_Y = 10, TANK_BOTTOM_Y = 200;

const STATUS_LABEL = { aman: "AMAN", waspada: "WASPADA", kritis: "KRITIS" };

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

  document.getElementById("tank-line-today").setAttribute("y1", yToday);
  document.getElementById("tank-line-today").setAttribute("y2", yToday);
  document.getElementById("tank-line-pred").setAttribute("y1", yPred);
  document.getElementById("tank-line-pred").setAttribute("y2", yPred);

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

function updateConfidence(stdDevPohon) {
  const el = document.getElementById("gauge-confidence");
  if (stdDevPohon === undefined || stdDevPohon === null) { el.textContent = ""; return; }
  let label;
  if (stdDevPohon < 0.05) label = "Tinggi";
  else if (stdDevPohon < 0.15) label = "Sedang";
  else label = "Rendah";
  el.textContent = `Tingkat keyakinan model: ${label} (σ pohon = ${stdDevPohon.toFixed(3)} m)`;
}

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
  const spinnerEl = submitBtn.querySelector(".btn-spinner");
  const labelEl = submitBtn.querySelector(".btn-label");
  submitBtn.disabled = true;
  spinnerEl.hidden = false;
  labelEl.textContent = "Memprediksi…";

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
    spinnerEl.hidden = true;
    labelEl.textContent = "Prediksi Elevasi Besok";
  }
});

["batas-waspada", "batas-kritis"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    if (document.getElementById("gauge-result").hidden) return;
    const prediksi = parseFloat(document.getElementById("gauge-value").textContent);
    const { batas_waspada, batas_kritis } = currentThresholds();
    let status = "aman";
    if (prediksi >= batas_kritis) status = "kritis";
    else if (prediksi >= batas_waspada) status = "waspada";
    const badgeEl = document.getElementById("status-badge");
    badgeEl.innerHTML = `${STATUS_ICON[status] || ""}<span>${STATUS_LABEL[status]}</span>`;
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
        <span class="importance-bar-track"><span class="importance-bar-fill" style="width:${pct}%"></span></span>
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
// BAGIAN 7: Sidebar — navigasi antar 7 halaman
// ------------------------------------------------------------------------
const PAGE_META = {
  ringkasan: { title: "Ringkasan Performa Model", sub: "Metrik hasil evaluasi model terhadap data historis." },
  tren: { title: "Tren Historis", sub: "Pergerakan elevasi muka air sump dari waktu ke waktu." },
  prediksi: { title: "Prediksi Elevasi Besok", sub: "Masukkan kondisi hari ini untuk memprediksi elevasi besok." },
  variabel: { title: "Variabel Berpengaruh", sub: "Kontribusi tiap variabel terhadap hasil prediksi model." },
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
// BAGIAN 8: Peta Lokasi — zoom (scroll) & pan (drag), + ganti gambar opsional
// ------------------------------------------------------------------------
const MAP_IMAGE_KEY = "peta_sump_gambar_custom";
const DEFAULT_MAP_SRC = "peta-sump.jpg";

const mapViewport = document.getElementById("map-viewport");
const mapImage = document.getElementById("map-image");
const mapFrame = document.getElementById("map-frame");

let mapScale = 1, mapX = 0, mapY = 0;
let mapMinScale = 1;
let isDragging = false, dragStartX = 0, dragStartY = 0, mapStartX = 0, mapStartY = 0;

function terapkanTransformPeta() {
  mapImage.style.transform = `translate(${mapX}px, ${mapY}px) scale(${mapScale})`;
}

function batasiPosisiPeta() {
  const frameRect = mapFrame.getBoundingClientRect();
  const imgW = mapImage.naturalWidth * mapScale;
  const imgH = mapImage.naturalHeight * mapScale;
  const minX = Math.min(0, frameRect.width - imgW);
  const minY = Math.min(0, frameRect.height - imgH);
  mapX = Math.max(minX, Math.min(0, mapX));
  mapY = Math.max(minY, Math.min(0, mapY));
}

function resetTampilanPeta() {
  if (!mapImage.naturalWidth) return;
  const frameRect = mapFrame.getBoundingClientRect();
  mapMinScale = Math.max(frameRect.width / mapImage.naturalWidth, frameRect.height / mapImage.naturalHeight);
  mapScale = mapMinScale;
  mapX = (frameRect.width - mapImage.naturalWidth * mapScale) / 2;
  mapY = (frameRect.height - mapImage.naturalHeight * mapScale) / 2;
  terapkanTransformPeta();
}

mapImage.addEventListener("load", resetTampilanPeta);
if (mapImage.complete && mapImage.naturalWidth) resetTampilanPeta();
window.addEventListener("resize", resetTampilanPeta);

function zoomPeta(faktor, clientX, clientY) {
  const frameRect = mapFrame.getBoundingClientRect();
  const cx = clientX !== undefined ? clientX - frameRect.left : frameRect.width / 2;
  const cy = clientY !== undefined ? clientY - frameRect.top : frameRect.height / 2;

  const scaleBaru = Math.min(Math.max(mapScale * faktor, mapMinScale), mapMinScale * 8);
  const rasio = scaleBaru / mapScale;

  mapX = cx - (cx - mapX) * rasio;
  mapY = cy - (cy - mapY) * rasio;
  mapScale = scaleBaru;

  batasiPosisiPeta();
  terapkanTransformPeta();
}

mapViewport.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomPeta(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
}, { passive: false });

document.getElementById("map-zoom-in").addEventListener("click", () => zoomPeta(1.3));
document.getElementById("map-zoom-out").addEventListener("click", () => zoomPeta(1 / 1.3));
document.getElementById("map-zoom-reset").addEventListener("click", resetTampilanPeta);

mapViewport.addEventListener("mousedown", (e) => {
  isDragging = true;
  mapViewport.classList.add("grabbing");
  dragStartX = e.clientX; dragStartY = e.clientY;
  mapStartX = mapX; mapStartY = mapY;
});
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  mapX = mapStartX + (e.clientX - dragStartX);
  mapY = mapStartY + (e.clientY - dragStartY);
  batasiPosisiPeta();
  terapkanTransformPeta();
});
window.addEventListener("mouseup", () => { isDragging = false; mapViewport.classList.remove("grabbing"); });

// Dukungan sentuh (mobile/tablet) — satu jari untuk geser
mapViewport.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  isDragging = true;
  dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
  mapStartX = mapX; mapStartY = mapY;
}, { passive: true });
mapViewport.addEventListener("touchmove", (e) => {
  if (!isDragging || e.touches.length !== 1) return;
  mapX = mapStartX + (e.touches[0].clientX - dragStartX);
  mapY = mapStartY + (e.touches[0].clientY - dragStartY);
  batasiPosisiPeta();
  terapkanTransformPeta();
}, { passive: true });
mapViewport.addEventListener("touchend", () => { isDragging = false; });

document.getElementById("map-upload-input")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(MAP_IMAGE_KEY, reader.result);
    mapImage.src = reader.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById("map-clear-btn")?.addEventListener("click", () => {
  localStorage.removeItem(MAP_IMAGE_KEY);
  mapImage.src = DEFAULT_MAP_SRC;
});

const customMap = localStorage.getItem(MAP_IMAGE_KEY);
if (customMap) mapImage.src = customMap;

// ------------------------------------------------------------------------
// BAGIAN 9: Riwayat Prediksi — disimpan di localStorage browser
// ------------------------------------------------------------------------
const RIWAYAT_KEY = "riwayat_prediksi_sump";

function ambilRiwayat() {
  try { return JSON.parse(localStorage.getItem(RIWAYAT_KEY)) || []; } catch { return []; }
}
function simpanRiwayat(list) { localStorage.setItem(RIWAYAT_KEY, JSON.stringify(list)); }

function tambahRiwayat(entry) {
  const list = ambilRiwayat();
  list.unshift(entry);
  simpanRiwayat(list.slice(0, 100));
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

// ------------------------------------------------------------------------
// BAGIAN 10: Animasi latar hujan — dipasang di cover & di belakang konten
// ------------------------------------------------------------------------
function buatHujan(containerId, jumlah) {
  const container = document.getElementById(containerId);
  if (!container) return;
  for (let i = 0; i < jumlah; i++) {
    const drop = document.createElement("span");
    drop.className = "rain-drop";
    const left = Math.random() * 100;
    const duration = 0.7 + Math.random() * 0.9;
    const delay = Math.random() * 3;
    const height = 40 + Math.random() * 50;
    const opacity = 0.4 + Math.random() * 0.5;
    drop.style.left = `${left}%`;
    drop.style.height = `${height}px`;
    drop.style.animationDuration = `${duration}s`;
    drop.style.animationDelay = `${delay}s`;
    drop.style.opacity = opacity;
    container.appendChild(drop);
  }
}

buatHujan("rain-cover", 70);
buatHujan("rain-content", 55);

// ------------------------------------------------------------------------
// INISIALISASI — jalankan semua saat halaman pertama kali dibuka
// ------------------------------------------------------------------------
loadModelInfo();
loadHistoricalChart();
loadFeatureImportance();
loadConstants();
updateComputedPreview();
renderRiwayat();
