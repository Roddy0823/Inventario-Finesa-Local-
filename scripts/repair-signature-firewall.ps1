param(
  [Parameter(Mandatory = $true)]
  [string] $LocalAddress
)

$ErrorActionPreference = 'Stop'
$parsed = $null
if (-not [System.Net.IPAddress]::TryParse($LocalAddress, [ref] $parsed) -or
    $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'Indique una dirección IPv4 local válida.'
}
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LocalAddress -ErrorAction SilentlyContinue)) {
  throw 'La dirección indicada no pertenece a este equipo.'
}
$rule = Get-NetFirewallRule -Name 'Finesa-Firmas-LAN'
$port = $rule | Get-NetFirewallPortFilter
if ($rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or
    $port.Protocol -ne 'TCP' -or $port.LocalPort -ne '8080') {
  throw 'La regla existente no coincide con el servicio de firmas; no se modifica.'
}

# Mantiene el perfil, puerto y red remota existentes. No cambia políticas globales.
Set-NetFirewallRule -Name $rule.Name -LocalAddress $LocalAddress
$rule | Get-NetFirewallAddressFilter | Select-Object LocalAddress, RemoteAddress
