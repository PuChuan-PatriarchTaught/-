# 精舍活動報到系統

現場掃 QR Code 對照出席名單，即時完成報到登記、回報結果，並可查詢該場法會相關資料。

## 架構（v2.0）

因 Google Apps Script 內建網頁（HtmlService）在部分手機瀏覽器會因為外層 iframe 沙盒限制、
導致相機權限無法開啟，本專案自 v2.0 起改為前後端分離：

- **後端（API）**：`Code.gs`，部署為 Google Apps Script Web App，以 JSON 格式提供報到、
  場次管理、統計等 API，資料儲存在 Google Sheet（出席名單）與 Script Properties（場次設定）。
- **前端（靜態網頁）**：`checkin.html`（報到台掃碼頁）、`admin.html`（場次管理頁），
  透過 `fetch()` 呼叫上述 API。建議放在 GitHub Pages 或任何靜態網頁空間，
  以取得正常的瀏覽器相機權限。

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `Code.gs` | Apps Script 後端 API（貼到 Apps Script 編輯器） |
| `checkin.html` | 報到台掃碼頁（部署到 GitHub Pages 等靜態空間） |
| `admin.html` | 場次管理頁（同上，僅管理人員使用） |
| `安裝與設定指南.md` | 完整部署步驟 |

## 快速開始

詳細步驟請見 `安裝與設定指南.md`，簡述如下：

1. 將 `Code.gs` 貼到新的 Apps Script 專案，部署為 Web App（執行身分：我；存取權限：知道連結的任何人），取得 `.../exec` 網址。
2. 把 `checkin.html` 與 `admin.html` 內的 `GAS_API_URL` 改成上一步取得的網址。
3. 將本資料夾推送到 GitHub，於 Settings → Pages 啟用 GitHub Pages。
4. 開啟 GitHub Pages 上的 `admin.html` 設定活動場次，再由報到台開啟 `checkin.html` 開始報到。
