; Дополнения к установщику NetAdmin Desk для Windows (подключается electron-builder автоматически).
;
; 1. Проверка версии Windows: Electron работает только на Windows 10 / Server 2016 и новее.
; 2. Необязательный шаг «Дополнительно»: браузер NetLoom.
;    - галочка по умолчанию снята; рядом предупреждение, что для NetLoom нужен интернет;
;    - сам NetAdmin Desk ставится без интернета, NetLoom скачивается с GitHub только по галочке;
;    - файл проверяется по SHA-256 из build/netloom.nsh и ставится в тихом режиме;
;    - NetLoom ставится от имени пользователя (как и при обычной установке NetLoom),
;      даже если NetAdmin Desk устанавливается «для всех пользователей» с правами администратора;
;    - если NetLoom поставить не удалось, NetAdmin Desk всё равно установлен — показывается причина.
;    Тихая установка вместе с NetLoom:  NetAdminDesk-Windows-x64-Setup.exe /S /NETLOOM=1
; 3. Деинсталлятор: удаление программы удаляет и все её данные (deleteAppDataOnUninstall в
;    electron-builder.yml; при обновлении данные остаются). На первой странице — предупреждение.

!ifndef BUILD_UNINSTALLER

!include "${BUILD_RESOURCES_DIR}\netloom.nsh"
; Заголовки подключаются здесь явно: шаблон electron-builder подключает не все из них
; (например, WordFunc для ${VersionCompare} в версии 26.18 не подключён)
!include LogicLib.nsh
!include FileFunc.nsh
!include WinVer.nsh
!include WordFunc.nsh
!include nsDialogs.nsh

!define NETLOOM_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NetLoom"
!define NETLOOM_RELEASES "https://github.com/uproxe/NetLoom/releases"
; Журнал установки NetLoom (в папке временных файлов пользователя) — причина видна и при /S
!define NETLOOM_LOG "$TEMP\NetAdminDesk-NetLoom.log"

; Дописать строку в журнал. Журнал в UTF-16 с BOM — русский текст читается на Windows с любым языком
; системы (в ANSI на английской Windows он превратился бы в «???»). $4 — рабочий регистр.
!macro NetLoomLog text
  FileOpen $4 "${NETLOOM_LOG}" a
  FileSeek $4 0 END
  FileWriteUTF16LE $4 "${text}$\r$\n"
  FileClose $4
!macroend

Var NetLoomWanted     ; 1 — ставить NetLoom
Var NetLoomInstalled  ; установленная версия NetLoom или пусто
Var NetLoomCheckbox   ; галочка на странице (пусто, если галочки нет)
Var NetLoomBoldFont

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "NetAdmin Desk работает на Windows 10, Windows 11 и Windows Server 2016 и новее.$\r$\n$\r$\nНа этой версии Windows программа не запустится: платформа Electron, на которой она сделана, не поддерживает Windows 7, 8, 8.1 и Windows Server 2012 / 2012 R2." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}

  StrCpy $NetLoomWanted 0
  Push $R0
  Push $R1
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NETLOOM=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 == "1"
    StrCpy $NetLoomWanted 1
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

; Шаг «Дополнительно» — сразу после выбора папки
!macro customPageAfterChangeDir
  Page custom NetLoomPageShow NetLoomPageLeave
!macroend

!macro customInstall
  ${If} $NetLoomWanted == 1
    Call NetLoomInstallMain
  ${EndIf}
!macroend

; Функции объявляются здесь: к этому месту уже подключены MUI, UAC и WordFunc
!macro customHeader
  ; --- выполняются в процессе пользователя (без повышения прав) ---

  Function NetLoomReadVersion
    ReadRegStr $0 HKCU "${NETLOOM_UNINST_KEY}" "DisplayVersion"
  FunctionEnd

  ; Результат: $0 — код (0 — установлен), $1 — причина ошибки
  Function NetLoomDoInstall
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File "/oname=$PLUGINSDIR\netloom-install.ps1" "${BUILD_RESOURCES_DIR}\netloom-install.ps1"
    StrCpy $2 "$PLUGINSDIR\NetLoom-${NETLOOM_VERSION}-setup.exe"
    StrCpy $1 ""
    Delete "${NETLOOM_LOG}"
    FileOpen $4 "${NETLOOM_LOG}" w
    FileWriteWord $4 0xFEFF
    FileClose $4
    !insertmacro NetLoomLog "NetAdmin Desk: установка браузера NetLoom ${NETLOOM_VERSION}"
    !insertmacro NetLoomLog "Загрузка: ${NETLOOM_URL}"

    nsExec::ExecToLog /OEM '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\netloom-install.ps1" -Url "${NETLOOM_URL}" -Sha256 "${NETLOOM_SHA256}" -Out "$2" -ExpectedBytes ${NETLOOM_BYTES} -Log "${NETLOOM_LOG}"'
    Pop $0
    !insertmacro NetLoomLog "Загрузка и проверка: код $0"
    ${If} $0 == 2
      StrCpy $1 "не удалось скачать файл с github.com — нет интернета или доступ к GitHub закрыт."
    ${ElseIf} $0 == 3
      StrCpy $1 "скачанный файл не прошёл проверку контрольной суммы (повреждён или подменён), поэтому он удалён и не запускался."
    ${ElseIf} $0 == 4
      StrCpy $1 "неверные параметры загрузки в установщике."
    ${ElseIf} $0 == 5
      StrCpy $1 "непредвиденная ошибка при загрузке (текст ошибки — в журнале)."
    ${ElseIf} $0 != 0
      StrCpy $1 "не удалось запустить загрузку через PowerShell (код $0) — возможно, PowerShell запрещён политикой."
    ${EndIf}
    ${If} $1 != ""
      !insertmacro NetLoomLog "Ошибка: $1"
      Delete "$2"
      SetOutPath "$TEMP"
      Return
    ${EndIf}

    !insertmacro NetLoomLog "Запуск установщика NetLoom в тихом режиме"
    ClearErrors
    ExecWait '"$2" /S' $0
    ${If} ${Errors}
      StrCpy $1 "не удалось запустить установщик NetLoom."
      StrCpy $0 1
    ${ElseIf} $0 != 0
      StrCpy $1 "установщик NetLoom завершился с кодом $0."
    ${Else}
      Call NetLoomReadVersion
      ${If} $0 == "${NETLOOM_VERSION}"
        StrCpy $0 0
      ${Else}
        StrCpy $1 "после установки NetLoom ${NETLOOM_VERSION} не найден в списке программ (там: «$0»)."
        StrCpy $0 1
      ${EndIf}
    ${EndIf}
    ${If} $0 == 0
      !insertmacro NetLoomLog "Готово: NetLoom ${NETLOOM_VERSION} установлен."
    ${Else}
      !insertmacro NetLoomLog "Ошибка: $1"
    ${EndIf}
    Delete "$2"
    SetOutPath "$TEMP"
  FunctionEnd

  ; --- выполняются в установщике; при установке «для всех» вызывают функции выше от имени пользователя ---

  Function NetLoomGetInstalled
    Push $0
    StrCpy $0 ""
    ${If} ${UAC_IsInnerInstance}
      !insertmacro UAC_AsUser_Call Function NetLoomReadVersion ${UAC_SYNCREGISTERS}
    ${Else}
      Call NetLoomReadVersion
    ${EndIf}
    StrCpy $NetLoomInstalled $0
    Pop $0
  FunctionEnd

  Function NetLoomPageShow
    Call NetLoomGetInstalled
    !insertmacro MUI_HEADER_TEXT "Дополнительно" "Необязательные программы"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    CreateFont $NetLoomBoldFont "$(^Font)" "$(^FontSize)" "700"
    StrCpy $NetLoomCheckbox ""

    ${If} $NetLoomInstalled != ""
      ${VersionCompare} "$NetLoomInstalled" "${NETLOOM_VERSION}" $1
      ${If} $1 != 2
        ; установлена такая же или более новая версия — предлагать нечего
        StrCpy $NetLoomWanted 0
        ${NSD_CreateLabel} 0 0 100% 24u "Браузер NetLoom $NetLoomInstalled уже установлен — дополнительно ставить ничего не нужно."
        Pop $0
        nsDialogs::Show
        Return
      ${EndIf}
      StrCpy $2 "Обновить браузер NetLoom до версии ${NETLOOM_VERSION} (сейчас $NetLoomInstalled)"
    ${Else}
      StrCpy $2 "Также установить браузер NetLoom ${NETLOOM_VERSION}"
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 12u "$2"
    Pop $NetLoomCheckbox
    ${If} $NetLoomWanted == 1
      ${NSD_Check} $NetLoomCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 12u 16u -12u 20u "Приватный браузер со встроенным VPN и блокировкой рекламы. Ставится только для вас, права администратора ему не нужны."
    Pop $0

    ${NSD_CreateLabel} 12u 44u -12u 10u "Понадобится интернет"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $NetLoomBoldFont 1
    ${NSD_CreateLabel} 12u 56u -12u 40u "NetLoom (около ${NETLOOM_SIZE_MB} МБ) скачивается с github.com во время установки и перед запуском проверяется по контрольной сумме SHA-256. Без интернета NetLoom не установится, но сам NetAdmin Desk установится в любом случае — интернет ему не нужен."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function NetLoomPageLeave
    ${If} $NetLoomCheckbox != ""
      ${NSD_GetState} $NetLoomCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $NetLoomWanted 1
      ${Else}
        StrCpy $NetLoomWanted 0
      ${EndIf}
    ${EndIf}
  FunctionEnd

  Function NetLoomInstallMain
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    DetailPrint "Браузер NetLoom ${NETLOOM_VERSION}: загрузка с github.com (около ${NETLOOM_SIZE_MB} МБ)…"
    ${If} ${UAC_IsInnerInstance}
      !insertmacro UAC_AsUser_Call Function NetLoomDoInstall ${UAC_SYNCREGISTERS}
    ${Else}
      Call NetLoomDoInstall
    ${EndIf}
    ${If} $0 == 0
      DetailPrint "Браузер NetLoom ${NETLOOM_VERSION} установлен."
    ${Else}
      DetailPrint "Браузер NetLoom не установлен: $1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "NetAdmin Desk установлен, а браузер NetLoom — нет:$\r$\n$1$\r$\n$\r$\nПодробности — в журнале %TEMP%\NetAdminDesk-NetLoom.log.$\r$\nNetLoom можно установить позже со страницы$\r$\n${NETLOOM_RELEASES}" /SD IDOK
    ${EndIf}
    SetOutPath "$INSTDIR"
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!else

; ===== Деинсталлятор =====
; Первая страница предупреждает, что вместе с программой удаляются все её данные.
; При обновлении программы (тихий запуск с --updated) страниц нет и данные не удаляются.
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Удаление NetAdmin Desk"
  !define MUI_WELCOMEPAGE_TEXT "Вместе с программой будут удалены все её данные на этом компьютере: устройства и пароли к ним, менеджер паролей, узлы и журнал мониторинга, резервные копии конфигураций, история и настройки (папка %APPDATA%\NetAdmin Desk).$\r$\n$\r$\nЕсли данные понадобятся, сначала сохраните их в программе: «Настройки → Импорт и экспорт → Зашифрованный экспорт всех данных», менеджер паролей — «Менеджер паролей → Экспорт».$\r$\n$\r$\nБраузер NetLoom это не затронет — он удаляется отдельно."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!endif
