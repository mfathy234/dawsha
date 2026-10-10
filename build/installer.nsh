!macro dawshaBroadcastEnvironment
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x1a, i 0, t "Environment", i 2, i 5000, *i .r0)'
!macroend

!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\path-edit.ps1" -Mode Add -Dir "$INSTDIR"'
  Pop $0
  !insertmacro dawshaBroadcastEnvironment
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\path-edit.ps1" -Mode Remove -Dir "$INSTDIR"'
  Pop $0
  !insertmacro dawshaBroadcastEnvironment
!macroend
