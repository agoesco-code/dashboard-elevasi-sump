/* ========================================================================
   SCRIPT DASHBOARD
   File ini menghubungkan halaman (HTML) ke backend Flask (app.py) lewat
   API. Dibagi jadi 4 bagian sesuai section di halaman:
     1. Ambil & tampilkan metrik performa model
     2. Ambil & tampilkan grafik historis (pakai Chart.js)
     3. Kirim form prediksi ke backend, tampilkan hasil di gauge
     4. Ambil & tampilkan feature importance
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

    // Kalau chart sudah pernah dibuat, cukup update datanya (lebih cepat
    // & tidak "berkedip" dibanding membuat ulang dari nol)
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

// Tombol filter rentang waktu (90 hari / 180 hari / semua)
document.querySelectorAll(".range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const days = parseInt(btn.dataset.days, 10);
    loadHistoricalChart(days);
  });
});

// ------------------------------------------------------------------------
// BAGIAN 3: Form prediksi -> gauge hasil
// ------------------------------------------------------------------------
const GAUGE_CIRCUMFERENCE = 540.35; // 2 * PI * r(86), dihitung dari SVG di HTML

function updateGauge(prediksi, deltaInput, elevasiHariIni) {
  document.getElementById("gauge-empty").hidden = true;
  const resultEl = document.getElementById("gauge-result");
  resultEl.hidden = false;

  document.getElementById("gauge-value").textContent = prediksi.toFixed(3);

  // Isi lingkaran gauge berdasarkan seberapa besar perubahan elevasi
  // diprediksi (dibatasi 0-100% secara visual, bukan skala eksak)
  const deltaPrediksi = prediksi - elevasiHariIni;
  const pct = Math.min(Math.abs(deltaPrediksi) / 2, 1); // asumsi 2m = perubahan besar
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
}

document.getElementById("predict-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("form-error");
  errorEl.textContent = "";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

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

    updateGauge(
      data.prediksi_elevasi_besok,
      data.delta_elevasi_input,
      parseFloat(payload.elevasi_hari_ini)
    );
  } catch (err) {
    errorEl.textContent = "Tidak bisa terhubung ke server prediksi. Coba lagi sebentar.";
    console.error("predict error:", err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Prediksi Elevasi Besok";
  }
});

// ------------------------------------------------------------------------
// BAGIAN 4: Feature importance
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
