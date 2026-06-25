param(
  [Parameter(Mandatory = $true)][string]$Port,
  [int]$Baud = 9600,
  [Parameter(Mandatory = $true)][string]$File
)
# Envía bytes en crudo (ESC/POS) a una impresora conectada por puerto serie (COM).
try {
  $bytes = [System.IO.File]::ReadAllBytes($File)
  $sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
  $sp.Handshake = [System.IO.Ports.Handshake]::None
  $sp.DtrEnable = $true
  $sp.RtsEnable = $true
  $sp.WriteTimeout = 7000
  $sp.Open()
  $sp.Write($bytes, 0, $bytes.Length)
  Start-Sleep -Milliseconds 400
  $sp.Close()
  exit 0
} catch {
  exit 1
}
