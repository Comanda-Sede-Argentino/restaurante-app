param([Parameter(Mandatory=$true)][string]$File, [string]$Printer)
# Imprime un archivo de texto a una impresora de Windows por nombre (driver GDI / Out-Printer).
try {
  if ($Printer) { Get-Content -LiteralPath $File -Encoding Default | Out-Printer -Name $Printer }
  else { Get-Content -LiteralPath $File -Encoding Default | Out-Printer }
  exit 0
} catch { exit 1 }
