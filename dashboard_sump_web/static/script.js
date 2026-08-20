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
// BAGIAN 4: Form prediksi -> gauge hasil + status badge
// ------------------------------------------------------------------------
const GAUGE_CIRCUMFERENCE = 540.35; // 2 * PI * r(86), dihitung dari SVG di HTML

const STATUS_LABEL = {
  aman: "AMAN",
  waspada: "WASPADA",
  kritis: "KRITIS",
};

function updateGauge(prediksi, elevasiHariIni, status) {
  document.getElementById("gauge-empty").hidden = true;
  const resultEl = document.getElementById("gauge-result");
  resultEl.hidden = false;

  document.getElementById("gauge-value").textContent = prediksi.toFixed(3);

  const deltaPrediksi = prediksi - elevasiHariIni;
  const pct = Math.min(Math.abs(deltaPrediksi) / 2, 1);
  const offset = GAUGE_CIRCUMFERENCE * (1 - pct);
  document.getElementById("gauge-fill-circle").style.strokeDashoffset = offset;

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
  badgeEl.textContent = STATUS_LABEL[status] || status;
  badgeEl.className = `status-badge status-${status}`;
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
// INISIALISASI — jalankan semua saat halaman pertama kali dibuka
// ------------------------------------------------------------------------
loadModelInfo();
loadHistoricalChart();
loadFeatureImportance();
loadAkumulasiContext();
updateComputedPreview();
