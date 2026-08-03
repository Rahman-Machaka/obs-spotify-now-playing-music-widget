Option Explicit

Dim shell, fileSystem, projectRoot, nodePath, serverEntry, action, command, waitForExit
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
nodePath = FindNode(fileSystem, shell)
serverEntry = fileSystem.BuildPath(projectRoot, "build\server\server\index.js")
action = "start"

If WScript.Arguments.Count > 0 Then
  action = LCase(WScript.Arguments(0))
End If

If action <> "start" And action <> "stop" And action <> "status" Then
  WScript.Quit 2
End If

If Not fileSystem.FileExists(serverEntry) Then
  WScript.Quit 3
End If

shell.CurrentDirectory = projectRoot
command = Quote(nodePath) & " " & Quote(serverEntry) & " " & action
waitForExit = (action <> "start")

' Window style 0 keeps the Node console completely hidden.
WScript.Quit shell.Run(command, 0, waitForExit)

Function FindNode(fso, wsh)
  Dim standardPath, pathEntries, entry, candidate
  standardPath = wsh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
  If fso.FileExists(standardPath) Then
    FindNode = standardPath
    Exit Function
  End If

  pathEntries = Split(wsh.ExpandEnvironmentStrings("%PATH%"), ";")
  For Each entry In pathEntries
    If Len(entry) > 0 Then
      candidate = fso.BuildPath(entry, "node.exe")
      If fso.FileExists(candidate) Then
        FindNode = candidate
        Exit Function
      End If
    End If
  Next

  FindNode = "node.exe"
End Function

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
