/**
 * ============================================================
 * 護法會頒證出席報到系統－後端 API 主程式 Code.gs
 * 版本：v2.0
 * 說明：Google Apps Script Web App，以 JSON API 形式提供服務。
 *       前端（相機掃碼頁／場次管理頁）改為獨立靜態網頁（放在 GitHub Pages），
 *       透過 fetch() 呼叫本 API，不再使用 google.script.run。
 *       改版原因：Apps Script HtmlService 頁面在部分瀏覽器（尤其手機）
 *                 因為外層 iframe 沙盒限制，相機權限請求會被擋下、無法開啟鏡頭；
 *                 改用獨立網域的靜態頁面即可正常取得相機權限。
 * 命名規範：函式與變數採繁體中文命名，變數前綴為資料型態英文小寫代碼
 *           （str=字串, int=整數, bool=布林, arr=陣列, obj=物件）
 * ============================================================
 */

/** 場次清單存放於 Script Properties 的 key 名稱（固定值，不需更改） */
const KEY_場次清單 = 'CHECKIN_場次清單';
/** 目前啟用場次存放於 Script Properties 的 key 名稱（固定值，不需更改） */
const KEY_目前場次 = 'CHECKIN_目前場次';
/** 出席名單中，用來比對報到身分的欄位標題（需與 Google Sheet 表頭文字完全一致） */
const 欄位_學員編號 = '學員編號';
/** 出席名單中，記錄是否已報到的欄位標題 */
const 欄位_報到 = '報到';
/** 出席名單中，記錄報到時間戳記的欄位標題 */
const 欄位_報到時間 = '報到時間';
/** 出席名單中，個人化注意事項欄位標題（選填，若無此欄位則略過不顯示） */
const 欄位_注意事項 = '注意事項';


/* ============================================================
 * API 進入點：doGet／doPost
 * ============================================================ */

/**
 * v2.0
 * doGet：Google Apps Script Web App 的固定進入點名稱，平台規定不可更名。
 * 讀取類 API（不會修改資料）走 GET，以網址參數 action 指定動作：
 *   ?action=getSessionList   → 取得場次清單
 *   ?action=getCurrentSession→ 取得目前場次資訊
 *   ?action=getStats         → 取得報到統計
 * 若沒有帶 action 參數，回傳簡易說明頁（避免直接開啟網址時顯示空白或錯誤）。
 */
function doGet(e) {
  var str動作 = e && e.parameter ? e.parameter.action : null;
  try {
    var obj回應;
    switch (str動作) {
      case 'getSessionList':
        obj回應 = { bool成功: true, arr場次清單: 取得場次清單() };
        break;
      case 'getCurrentSession':
        obj回應 = { bool成功: true, obj場次: 取得目前場次資訊() };
        break;
      case 'getStats':
        obj回應 = 取得報到統計();
        break;
      default:
        return HtmlService.createHtmlOutput(
          '<p>護法會頒證出席報到系統 API 後端運作中。</p>' +
          '<p>本頁不提供操作介面，請至前端網頁（GitHub Pages）進行報到或場次管理。</p>'
        );
    }
    return 輸出JSON(obj回應);
  } catch (e2) {
    return 輸出JSON({ bool成功: false, str訊息: 'API 錯誤：' + e2.message });
  }
}

/**
 * v2.0
 * doPost：Google Apps Script Web App 的固定進入點名稱，平台規定不可更名。
 * 寫入類 API（會修改 Google Sheet 或設定值）走 POST，前端需以
 * Content-Type: text/plain;charset=utf-8 送出 JSON 字串（避免觸發瀏覽器 CORS 預檢，
 * Apps Script 不支援處理 OPTIONS 預檢請求）。
 * 請求格式：{ action: 'checkin'|'addSession'|'deleteSession'|'setCurrentSession', ...參數 }
 */
function doPost(e) {
  try {
    var objBody = JSON.parse(e.postData.contents);
    var str動作 = objBody.action;
    var obj回應;

    switch (str動作) {
      case 'checkin':
        obj回應 = 執行報到(objBody.str學員編號);
        break;
      case 'addSession':
        obj回應 = 新增場次(objBody.str場次名稱, objBody.str試算表ID, objBody.str工作表名稱, objBody.str法會公告);
        break;
      case 'deleteSession':
        obj回應 = 刪除場次(objBody.str場次名稱);
        break;
      case 'setCurrentSession':
        obj回應 = 設定目前場次(objBody.str場次名稱);
        break;
      default:
        obj回應 = { bool成功: false, str訊息: '未知的操作：' + str動作 };
    }
    return 輸出JSON(obj回應);
  } catch (e2) {
    return 輸出JSON({ bool成功: false, str訊息: 'API 錯誤：' + e2.message });
  }
}

/**
 * v2.0
 * 輸出JSON：統一將回應物件包裝為 JSON 格式輸出。
 * 使用說明：Apps Script Web App 對簡單 GET／POST（無自訂標頭）請求
 *           會自動允許跨網域讀取，前端可直接用 fetch() 呼叫，不需額外設定。
 */
function 輸出JSON(objData) {
  return ContentService.createTextOutput(JSON.stringify(objData))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
 * 模組：場次／名單管理
 * ============================================================ */

/**
 * v1.0
 * 取得場次清單：回傳目前所有已登錄的活動場次設定。
 * 回傳格式：arr場次清單 = [{ str場次名稱, str試算表ID, str工作表名稱, str法會公告 }, ...]
 */
function 取得場次清單() {
  var strJSON = PropertiesService.getScriptProperties().getProperty(KEY_場次清單);
  var arr場次清單 = strJSON ? JSON.parse(strJSON) : [];
  return arr場次清單;
}

/**
 * v1.0
 * 新增場次：登錄一個新的活動場次（對應一份出席名單 Google Sheet）。
 * 參數：str場次名稱（例如「2026年護法會幹部聯誼」）
 *       str試算表ID（Google Sheet 網址中 /d/ 與 /edit 之間那段亂碼）
 *       str工作表名稱（分頁名稱，例如「出席名單」，預設為第一個分頁）
 *       str法會公告（選填，報到成功後顯示給學員看的法會相關資料，例如流程／地點／注意事項，支援換行）
 * 錯誤處理：場次名稱重複時會直接覆蓋原設定，並提示使用者。
 */
function 新增場次(str場次名稱, str試算表ID, str工作表名稱, str法會公告) {
  try {
    if (!str場次名稱 || !str試算表ID) {
      throw new Error('場次名稱與試算表ID皆為必填，請重新輸入。');
    }
    // 先驗證試算表ID與工作表是否存在，避免登錄錯誤的設定
    var objSpreadsheet = SpreadsheetApp.openById(str試算表ID);
    var objSheet = str工作表名稱
      ? objSpreadsheet.getSheetByName(str工作表名稱)
      : objSpreadsheet.getSheets()[0];
    if (!objSheet) {
      throw new Error('找不到指定的工作表「' + str工作表名稱 + '」，請確認分頁名稱是否正確。');
    }

    var arr場次清單 = 取得場次清單();
    var bool已存在 = false;
    for (var i = 0; i < arr場次清單.length; i++) {
      if (arr場次清單[i].str場次名稱 === str場次名稱) {
        arr場次清單[i].str試算表ID = str試算表ID;
        arr場次清單[i].str工作表名稱 = objSheet.getName();
        arr場次清單[i].str法會公告 = str法會公告 || '';
        bool已存在 = true;
        break;
      }
    }
    if (!bool已存在) {
      arr場次清單.push({
        str場次名稱: str場次名稱,
        str試算表ID: str試算表ID,
        str工作表名稱: objSheet.getName(),
        str法會公告: str法會公告 || ''
      });
    }
    PropertiesService.getScriptProperties().setProperty(KEY_場次清單, JSON.stringify(arr場次清單));
    return { bool成功: true, str訊息: (bool已存在 ? '已更新場次「' : '已新增場次「') + str場次名稱 + '」' };
  } catch (e) {
    return { bool成功: false, str訊息: '新增場次失敗：' + e.message };
  }
}

/**
 * v1.0
 * 刪除場次：移除已登錄的場次設定（不會刪除 Google Sheet 本身，僅移除系統中的登錄）。
 */
function 刪除場次(str場次名稱) {
  try {
    var arr場次清單 = 取得場次清單();
    var arr篩選後 = arr場次清單.filter(function (obj場次) {
      return obj場次.str場次名稱 !== str場次名稱;
    });
    PropertiesService.getScriptProperties().setProperty(KEY_場次清單, JSON.stringify(arr篩選後));

    // 若刪除的剛好是目前啟用場次，一併清除「目前場次」設定，避免報到台指向不存在的場次
    var str目前場次 = PropertiesService.getScriptProperties().getProperty(KEY_目前場次);
    if (str目前場次 === str場次名稱) {
      PropertiesService.getScriptProperties().deleteProperty(KEY_目前場次);
    }
    return { bool成功: true, str訊息: '已刪除場次「' + str場次名稱 + '」' };
  } catch (e) {
    return { bool成功: false, str訊息: '刪除場次失敗：' + e.message };
  }
}

/**
 * v1.0
 * 設定目前場次：所有報到台皆會依此設定讀寫對應的出席名單，全域生效（不分裝置）。
 */
function 設定目前場次(str場次名稱) {
  try {
    var arr場次清單 = 取得場次清單();
    var bool存在 = arr場次清單.some(function (obj場次) {
      return obj場次.str場次名稱 === str場次名稱;
    });
    if (!bool存在) {
      throw new Error('查無此場次，請先於場次清單中新增。');
    }
    PropertiesService.getScriptProperties().setProperty(KEY_目前場次, str場次名稱);
    return { bool成功: true, str訊息: '目前報到場次已切換為「' + str場次名稱 + '」' };
  } catch (e) {
    return { bool成功: false, str訊息: '切換場次失敗：' + e.message };
  }
}

/**
 * v1.0
 * 取得目前場次資訊：回傳目前啟用中的場次設定物件；若尚未設定則回傳 null。
 */
function 取得目前場次資訊() {
  var str目前場次 = PropertiesService.getScriptProperties().getProperty(KEY_目前場次);
  if (!str目前場次) return null;
  var arr場次清單 = 取得場次清單();
  for (var i = 0; i < arr場次清單.length; i++) {
    if (arr場次清單[i].str場次名稱 === str目前場次) {
      return arr場次清單[i];
    }
  }
  return null;
}


/* ============================================================
 * 模組：報到比對（含併發控制）
 * ============================================================ */

/**
 * v1.0
 * 執行報到：報到台掃描 QR Code 後呼叫的主要函式。
 * 參數：str學員編號（QR Code 掃描解碼出的內容）
 * 回傳：obj報到結果 = {
 *   bool成功, str狀態('報到成功'|'已報到過'|'查無此人'|'系統忙碌'),
 *   str姓名, str法名, str組別, str職務, str報到時間, str法會公告, str個人注意事項
 * }
 * 說明：str法會公告 取自該場次設定中管理人員填寫的公告文字（流程／地點／注意事項等），
 *       str個人注意事項 取自出席名單中該學員該列的「注意事項」欄位（例如個人任務提醒）；
 *       兩者僅在「報到成功」與「已報到過」時提供，供前端顯示給學員查詢。
 * 錯誤處理：
 *   - 使用 LockService 鎖定，避免多台報到台同時寫入造成資料錯亂或漏記。
 *   - 若逾時取不到鎖，回傳「系統忙碌」，前端應提示使用者重新掃描。
 *   - 若尚未設定目前場次，回傳明確錯誤訊息。
 */
function 執行報到(str學員編號) {
  var objLock = LockService.getScriptLock();
  try {
    // 最多等待 10 秒取得鎖，避免多報到台同時寫入衝突
    var bool取得鎖 = objLock.tryLock(10000);
    if (!bool取得鎖) {
      return { bool成功: false, str狀態: '系統忙碌', str訊息: '目前報到人數眾多，請稍後重新掃描一次。' };
    }

    var obj目前場次 = 取得目前場次資訊();
    if (!obj目前場次) {
      return { bool成功: false, str狀態: '尚未設定場次', str訊息: '尚未設定目前報到場次，請聯絡管理人員先設定場次。' };
    }
    if (!str學員編號) {
      return { bool成功: false, str狀態: '查無此人', str訊息: 'QR Code 內容為空，請重新掃描。' };
    }
    str學員編號 = str學員編號.toString().trim();

    var objSheet = SpreadsheetApp.openById(obj目前場次.str試算表ID)
      .getSheetByName(obj目前場次.str工作表名稱);
    var arrData = objSheet.getDataRange().getValues();
    var arr表頭 = arrData[0];
    var int學員編號欄 = arr表頭.indexOf(欄位_學員編號);
    var int報到欄 = arr表頭.indexOf(欄位_報到);
    var int報到時間欄 = arr表頭.indexOf(欄位_報到時間);
    var int注意事項欄 = arr表頭.indexOf(欄位_注意事項);
    var int姓名欄 = arr表頭.indexOf('姓名');
    var int法名欄 = arr表頭.indexOf('法名');
    var int組別欄 = arr表頭.indexOf('組別');
    var int職務欄 = arr表頭.indexOf('新任聘書');

    if (int學員編號欄 === -1 || int報到欄 === -1) {
      throw new Error('出席名單表頭缺少「學員編號」或「報到」欄位，請確認 Google Sheet 格式。');
    }

    for (var i = 1; i < arrData.length; i++) {
      var str此列編號 = arrData[i][int學員編號欄] ? arrData[i][int學員編號欄].toString().trim() : '';
      if (str此列編號 === str學員編號) {
        var str姓名 = int姓名欄 > -1 ? arrData[i][int姓名欄] : '';
        var str法名 = int法名欄 > -1 ? arrData[i][int法名欄] : '';
        var str組別 = int組別欄 > -1 ? arrData[i][int組別欄] : '';
        var str職務 = int職務欄 > -1 ? arrData[i][int職務欄] : '';
        var str個人注意事項 = int注意事項欄 > -1 ? (arrData[i][int注意事項欄] || '') : '';
        var str既有報到值 = arrData[i][int報到欄];

        if (str既有報到值) {
          // 已報到過：不覆蓋原資料，直接提示，避免誤判為新報到
          var str原報到時間 = int報到時間欄 > -1 ? arrData[i][int報到時間欄] : str既有報到值;
          return {
            bool成功: false,
            str狀態: '已報到過',
            str姓名: str姓名,
            str法名: str法名,
            str組別: str組別,
            str職務: str職務,
            str報到時間: str原報到時間 ? str原報到時間.toString() : '',
            str法會公告: obj目前場次.str法會公告 || '',
            str個人注意事項: str個人注意事項
          };
        }

        // 首次報到：分別寫入「報到」欄（打勾）與「報到時間」欄（時間戳記）
        var strNow = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
        objSheet.getRange(i + 1, int報到欄 + 1).setValue('✓');
        if (int報到時間欄 > -1) {
          objSheet.getRange(i + 1, int報到時間欄 + 1).setValue(strNow);
        }

        return {
          bool成功: true,
          str狀態: '報到成功',
          str姓名: str姓名,
          str法名: str法名,
          str組別: str組別,
          str職務: str職務,
          str報到時間: strNow,
          str法會公告: obj目前場次.str法會公告 || '',
          str個人注意事項: str個人注意事項
        };
      }
    }

    // 迴圈跑完仍找不到對應學員編號
    return { bool成功: false, str狀態: '查無此人', str學員編號: str學員編號 };

  } catch (e) {
    return { bool成功: false, str狀態: '系統錯誤', str訊息: '報到處理發生錯誤：' + e.message };
  } finally {
    objLock.releaseLock();
  }
}


/* ============================================================
 * 模組：統計／進度總覽
 * ============================================================ */

/**
 * v1.0
 * 取得報到統計：回傳目前場次的報到進度，供前端即時顯示。
 * 回傳：obj統計 = { int總人數, int已報到人數, arr依組別統計: [{str組別, int總人數, int已報到人數}, ...] }
 */
function 取得報到統計() {
  var obj目前場次 = 取得目前場次資訊();
  if (!obj目前場次) {
    return { bool成功: false, str訊息: '尚未設定目前報到場次。' };
  }
  try {
    var objSheet = SpreadsheetApp.openById(obj目前場次.str試算表ID)
      .getSheetByName(obj目前場次.str工作表名稱);
    var arrData = objSheet.getDataRange().getValues();
    var arr表頭 = arrData[0];
    var int報到欄 = arr表頭.indexOf(欄位_報到);
    var int組別欄 = arr表頭.indexOf('組別');

    var int總人數 = 0;
    var int已報到人數 = 0;
    var obj組別統計 = {}; // { 組別名稱: { int總人數, int已報到人數 } }

    for (var i = 1; i < arrData.length; i++) {
      var str編號 = arrData[i][arr表頭.indexOf(欄位_學員編號)];
      if (!str編號) continue; // 跳過空白列

      int總人數++;
      var bool已報到 = !!arrData[i][int報到欄];
      if (bool已報到) int已報到人數++;

      var str組別 = int組別欄 > -1 ? (arrData[i][int組別欄] || '未分類') : '未分類';
      if (!obj組別統計[str組別]) {
        obj組別統計[str組別] = { int總人數: 0, int已報到人數: 0 };
      }
      obj組別統計[str組別].int總人數++;
      if (bool已報到) obj組別統計[str組別].int已報到人數++;
    }

    var arr依組別統計 = Object.keys(obj組別統計).map(function (str組別) {
      return {
        str組別: str組別,
        int總人數: obj組別統計[str組別].int總人數,
        int已報到人數: obj組別統計[str組別].int已報到人數
      };
    });

    return {
      bool成功: true,
      str場次名稱: obj目前場次.str場次名稱,
      int總人數: int總人數,
      int已報到人數: int已報到人數,
      arr依組別統計: arr依組別統計
    };
  } catch (e) {
    return { bool成功: false, str訊息: '取得統計資料失敗：' + e.message };
  }
}
