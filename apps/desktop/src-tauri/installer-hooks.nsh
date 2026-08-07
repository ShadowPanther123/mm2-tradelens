; NSIS installer hook for MM2 TradeLens.
;
; Tauri's NSIS bundler includes these macros at the matching points of the
; generated installer/uninstaller. They let us keep the install clean and,
; crucially, preserve the user's local database on uninstall unless they opt in
; to a full wipe.
;
; The user's SQLite database and settings live in the per-user app-data folder
; ($LOCALAPPDATA\<identifier>), which the default uninstaller does NOT remove.
; We make that guarantee explicit and offer an optional clean removal.

!macro NSIS_HOOK_PREINSTALL
  ; Nothing to do before files are copied. A per-user install needs no elevation
  ; and writes only under the current user's profile.
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Installation finished. Application data is created lazily on first run, so
  ; there is nothing to seed here.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Preserve user data by default. Only offer to delete it during a full
  ; (non-silent) uninstall, and never touch it without an explicit "Yes".
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also delete your local MM2 TradeLens data (favourites, trade history and settings)?$\n$\nChoose No to keep them for a future reinstall." \
      /SD IDNO IDYES delete_userdata IDNO keep_userdata
    delete_userdata:
      RMDir /r "$LOCALAPPDATA\${MAINBINARYNAME}"
      RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
      Goto userdata_done
    keep_userdata:
    userdata_done:
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Nothing further to clean up; the app installs only per-user files.
!macroend
