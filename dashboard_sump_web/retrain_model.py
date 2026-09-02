"""
Melatih ulang model Linear Regression PERSIS mengikuti metodologi final
di `Linear_Regression_Sump.ipynb` (6 fitur, split kronologis 80:20),
memakai data terbaru `data/Data_Final.xlsx`. Hasil disimpan ke:
  model/model_linear_regression_elevasi_sump.pkl
  model/feature_columns.pkl
"""
import numpy as np
import pandas as pd
import joblib
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

DATA_PATH = "data/Data_Final.xlsx"

df = pd.read_excel(DATA_PATH, sheet_name=0)
df = df.sort_values("Tanggal").reset_index(drop=True)

# ---- Rekayasa fitur PERSIS seperti notebook Bagian 4 ----
df["Elevasi Muka Air Sump Kemarin (m)"] = df["Elevasi Muka Air Sump (m)"].shift(1)
df["Delta Elevasi (m)"] = df["Elevasi Muka Air Sump (m)"] - df["Elevasi Muka Air Sump Kemarin (m)"]
df["Akumulasi Hujan 3 Hari (mm)"] = df["Curah Hujan (mm)"].rolling(window=3, min_periods=1).sum()
df["Target_Elevasi_H1"] = df["Elevasi Muka Air Sump (m)"].shift(-1)

model_df = df.dropna(subset=["Elevasi Muka Air Sump Kemarin (m)", "Target_Elevasi_H1"]).reset_index(drop=True)

FEATURES = [
    "Curah Hujan (mm)",
    "Durasi Hujan (jam)",
    "Akumulasi Hujan 3 Hari (mm)",
    "Debit Air Limpasan (m³/detik)",
    "Elevasi Muka Air Sump (m)",
    "Delta Elevasi (m)",
]
TARGET = "Target_Elevasi_H1"

X = model_df[FEATURES].values
y = model_df[TARGET].values

split_idx = int(len(model_df) * 0.8)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

model = LinearRegression()
model.fit(X_train, y_train)

y_pred_test = model.predict(X_test)
rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
mae = mean_absolute_error(y_test, y_pred_test)
r2 = r2_score(y_test, y_pred_test)

print(f"Jumlah data model_df : {len(model_df)}")
print(f"Data latih (80%)     : {len(X_train)}")
print(f"Data uji (20%)       : {len(X_test)}")
print(f"Intercept            : {model.intercept_:.5f}")
for f, c in zip(FEATURES, model.coef_):
    print(f"  {f:35s}: {c:.5f}")
print(f"\nRMSE uji : {rmse:.4f}")
print(f"MAE  uji : {mae:.4f}")
print(f"R²   uji : {r2:.4f}")

joblib.dump(model, "model/model_linear_regression_elevasi_sump.pkl")
joblib.dump(FEATURES, "model/feature_columns.pkl")
print("\n✅ Model & feature_columns tersimpan ulang.")
