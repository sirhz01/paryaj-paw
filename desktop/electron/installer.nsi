; Installateur Windows de Paryaj Paw Boutik, compilé par makensis (pas de wine).
; Installation par utilisateur (pas de droits administrateur), raccourcis, désinstallateur.
Unicode true
SetCompressor /SOLID lzma

!define APP "Paryaj Paw Boutik"
!define EXE "Paryaj Paw Boutik.exe"
!define VERSION "0.1.0"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParyajPawBoutik"

Name "${APP} ${VERSION}"
OutFile "release/ParyajPawBoutik-${VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA/ParyajPawBoutik"
RequestExecutionLevel user
Icon "build/icon.ico"
UninstallIcon "build/icon.ico"
BrandingText "Paryaj Paw"
ShowInstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "release/win-unpacked/*"

  CreateShortCut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Paryaj Paw"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
