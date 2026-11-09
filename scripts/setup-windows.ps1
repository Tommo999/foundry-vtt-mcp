[CmdletBinding()]
param(
    [string] $FoundryOrigin,
    [string] $FoundryDataPath,
    [ValidateRange(1, 65535)] [int] $Port = 31415,
    [switch] $SkipPrerequisites,
    [switch] $NoStart,
    [switch] $NonInteractive,
    [switch] $NoDesktopShortcut,
    [string] $OutputDirectory
)

# This script intentionally uses only Windows PowerShell 5.1-compatible syntax.
# It can be dot-sourced by validation tools without starting setup.

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Get-ConfigDirectory {
    if (-not [string]::IsNullOrWhiteSpace($env:FOUNDRY_MCP_CONFIG_DIR)) {
        return [IO.Path]::GetFullPath($env:FOUNDRY_MCP_CONFIG_DIR)
    }
    $base = $env:APPDATA
    if ([string]::IsNullOrWhiteSpace($base)) { $base = $env:XDG_CONFIG_HOME }
    if ([string]::IsNullOrWhiteSpace($base)) { $base = Join-Path $env:USERPROFILE '.config' }
    return [IO.Path]::GetFullPath((Join-Path $base 'foundry-mcp'))
}

function Get-AbsolutePath([string] $Path, [string] $Label) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label cannot be empty." }
    try { return [IO.Path]::GetFullPath($Path) }
    catch { throw "$Label must be a valid absolute or relative path: $Path" }
}

function Get-CanonicalOrigin([string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'Foundry Origin is required.' }
    if ($Value -match '[\r\n]' -or $Value -match '^[^:]+://[^/@]*@') { throw 'Foundry Origin must not contain credentials or line breaks.' }
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref] $uri)) { throw 'Enter a valid HTTPS Foundry URL, such as https://vtt.example.com.' }
    if ($uri.Scheme -ne 'https' -or -not [string]::IsNullOrEmpty($uri.UserInfo)) { throw 'Foundry Origin must use HTTPS and must not contain credentials.' }
    if ($uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw 'Enter only the Foundry site origin (scheme, host, and optional port), without a path, query, or fragment.' }
    return $uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}

function Invoke-Native([string] $Executable, [string[]] $Arguments, [string] $Step, [switch] $AllowNonZero) {
    Write-Host "  $Step"
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Executable @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    if ($code -eq 3010) {
        $script:SetupRestartRequired = $true
        Write-Warning "$Step reported that Windows needs a restart to finish installation. Setup will continue if the installed tools are already available."
        return $code
    }
    if ($code -ne 0 -and -not $AllowNonZero) { throw "$Step failed (exit code $code). See the message above and retry after correcting the issue." }
    return $code
}

function Refresh-Path {
    $original = $env:PATH
    $machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $entries = @()
    foreach ($part in @($machine, $user, $original)) {
        if (-not [string]::IsNullOrWhiteSpace($part)) {
            foreach ($entry in $part -split ';') {
                if (-not [string]::IsNullOrWhiteSpace($entry) -and $entries -notcontains $entry) { $entries += $entry }
            }
        }
    }
    $env:PATH = $entries -join ';'
}

function Find-Executable([string] $Name, [string[]] $KnownPaths) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) { return [IO.Path]::GetFullPath($command.Source) }
    foreach ($candidate in $KnownPaths) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return [IO.Path]::GetFullPath($candidate) }
    }
    return $null
}

function Get-Tools {
    Refresh-Path
    $nodeKnown = @()
    if ($env:ProgramFiles) { $nodeKnown += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    if (${env:ProgramFiles(x86)}) { $nodeKnown += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
    if ($env:LOCALAPPDATA) {
        $nodeKnown += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\node.exe')
        $nodeKnown += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    }
    $mkKnown = @()
    if ($env:LOCALAPPDATA) { $mkKnown += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\mkcert.exe') }
    $node = Find-Executable 'node.exe' $nodeKnown
    $npmKnown = @()
    if ($node) { $npmKnown += (Join-Path (Split-Path -Parent $node) 'npm.cmd') }
    $npm = Find-Executable 'npm.cmd' $npmKnown
    if (-not $npm) { $npm = Find-Executable 'npm.cmd' @() }
    $mkcert = Find-Executable 'mkcert.exe' $mkKnown
    return @{ Node = $node; Npm = $npm; Mkcert = $mkcert }
}

function Test-NodeVersion([string] $NodePath) {
    if (-not $NodePath) { return $false }
    $version = (& $NodePath '--version' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    if ($version -match '^v?(\d+)\.(\d+)\.') {
        return ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 12))
    }
    return $false
}

function Install-Prerequisites([hashtable] $Tools, [switch] $Skip) {
    $nodeOk = Test-NodeVersion $Tools.Node
    $mkOk = [bool]$Tools.Mkcert
    if ($nodeOk -and $Tools.Npm -and $mkOk) { return (Get-Tools) }
    if ($Skip) { throw 'Prerequisites are missing or outdated. Install Node.js 22.12 or newer (including npm) and mkcert, then rerun without -SkipPrerequisites.' }
    $winget = Find-Executable 'winget.exe' @()
    if (-not $winget) { throw 'Windows Package Manager (winget) is unavailable. Install Node.js 22.12+ and mkcert manually from their official sources, then rerun this setup.' }
    if (-not $nodeOk -or -not $Tools.Npm) {
        [void](Invoke-Native $winget @('install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--installer-type', 'wix') 'Installing Node.js LTS with winget')
    }
    if (-not $mkOk) {
        [void](Invoke-Native $winget @('install', '--id', 'FiloSottile.mkcert', '--exact', '--source', 'winget', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements') 'Installing mkcert with winget')
    }
    $result = Get-Tools
    if (-not (Test-NodeVersion $result.Node) -or -not $result.Npm) { throw 'Node.js 22.12+ and npm were not found after installation. Close and reopen this window, then rerun setup; if that fails, install Node.js LTS manually.' }
    if (-not $result.Mkcert) { throw 'mkcert was not found after installation. Install mkcert from its official source, then rerun setup.' }
    return $result
}

function Set-ManagedAcl([string] $Directory) {
    [void][IO.Directory]::CreateDirectory($Directory)
    $directoryItem = Get-Item -Force -LiteralPath $Directory
    if (($directoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Managed directory is a link or junction; refusing to change permissions outside the setup folder: $Directory" }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    foreach ($sid in @($identity, $systemSid)) {
        $rule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, $allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}

function Set-ManagedFileAcl([string] $FilePath) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($identity, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $FilePath -AclObject $acl
}

function Invoke-Helper([string] $Node, [string] $Helper, [string[]] $Arguments, [string] $Action) {
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $Node $Helper @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    if ($code -ne 0) { throw "$Action failed. $($output | Out-String)" }
    return (($output | Out-String).Trim())
}

function Get-ConfigSummary([string] $Node, [string] $Helper, [string] $Command, [string] $ConfigPath) {
    $json = Invoke-Helper $Node $Helper @($Command, $ConfigPath) "Checking existing configuration"
    try { return ($json | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "The setup helper returned an invalid response while checking configuration. Preserve your files and contact support." }
}

function New-DesktopShortcut([string] $TargetScript, [string] $ShortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $TargetScript + '"'
    $shortcut.WorkingDirectory = Split-Path -Parent $TargetScript
    $shortcut.Save()
}

function Invoke-Setup([bool] $PortWasExplicit) {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This setup script runs on Windows 10 or 11. Run it on the Windows computer that will host the local companion.' }
    $project = Split-Path -Parent $PSScriptRoot
    $helper = Join-Path $PSScriptRoot 'windows-setup-helper.mjs'
    $cli = Join-Path $project 'packages\companion\dist\cli.js'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The Windows setup helper is missing from this source bundle (scripts/windows-setup-helper.mjs).' }

    $configDir = Get-ConfigDirectory
    $configPath = Join-Path $configDir 'config.json'
    $forbiddenDirs = @($env:USERPROFILE, $env:APPDATA, (Join-Path $env:USERPROFILE 'Documents'))
    $driveRoot = [IO.Path]::GetPathRoot($configDir)
    if ($configDir.TrimEnd([char]92) -eq $driveRoot.TrimEnd([char]92) -or $forbiddenDirs -contains $configDir.TrimEnd([char]92)) { throw 'FOUNDRY_MCP_CONFIG_DIR must point to a dedicated Foundry MCP configuration folder, not a drive root or general user folder.' }
    if (Test-Path -LiteralPath $configDir -PathType Container) {
        $configDirectoryItem = Get-Item -Force -LiteralPath $configDir
        if (($configDirectoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'FOUNDRY_MCP_CONFIG_DIR points to a link or junction. Use a dedicated real directory so setup does not alter permissions outside its managed folder.' }
    }
    $exists = Test-Path -LiteralPath $configPath -PathType Leaf
    if ($exists) {
        $configFileItem = Get-Item -Force -LiteralPath $configPath
        if (($configFileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The existing config.json is a link. Setup will not validate or modify a configuration outside its managed folder.' }
    }
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $configDir 'setup' }
    $OutputDirectory = Get-AbsolutePath $OutputDirectory 'Output directory'
    $configPrefix = $configDir.TrimEnd([char]92) + [char]92
    if (-not $OutputDirectory.StartsWith($configPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must be inside the managed Foundry MCP configuration folder so pairing files can be protected.' }
    $tools = Install-Prerequisites (Get-Tools) -Skip:$SkipPrerequisites
    Write-Step 'Building the companion from the source bundle'
    Push-Location -LiteralPath $project
    try {
        if (Test-Path -LiteralPath (Join-Path $project 'package-lock.json') -PathType Leaf) {
            [void](Invoke-Native $tools.Npm @('ci') 'Installing locked project dependencies')
        } else {
            [void](Invoke-Native $tools.Npm @('install') 'Installing project dependencies')
        }
        [void](Invoke-Native $tools.Npm @('run', 'package') 'Packaging the companion and Foundry module')
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'The build completed without producing packages/companion/dist/cli.js. Review the build output and rerun.' }

    if ($exists) {
        Write-Step 'Validating the existing companion configuration'
        $summary = Get-ConfigSummary $tools.Node $helper 'validate-config' $configPath
        if ($FoundryOrigin) {
            $requested = Get-CanonicalOrigin $FoundryOrigin
            if ($summary.origin -ne $requested) { throw 'The supplied Foundry Origin conflicts with the existing configuration. The existing config and pairing are unchanged; rerun without that value to preserve them.' }
        }
        if ($PortWasExplicit -and [int]$summary.port -ne $Port) { throw 'The supplied Port conflicts with the existing configuration. The existing config and pairing are unchanged; rerun with the configured port or omit -Port.' }
        $port = [int]$summary.port
    } else {
        Write-Step 'Collecting the Foundry site address'
        if (-not $FoundryOrigin) {
            if ($NonInteractive) { throw 'A new setup requires -FoundryOrigin when -NonInteractive is used.' }
            $FoundryOrigin = Read-Host 'Foundry HTTPS origin (example: https://vtt.example.com)'
        }
        $origin = Get-CanonicalOrigin $FoundryOrigin
        $port = $Port
    }

    if (-not (Test-Path -LiteralPath $configDir -PathType Container)) { Set-ManagedAcl $configDir }
    if ($exists) { Set-ManagedFileAcl $configPath }
    $tlsDir = Join-Path $configDir 'tls'
    Set-ManagedAcl $tlsDir
    Set-ManagedAcl $OutputDirectory

    if (-not $exists) {
        $certPath = Join-Path $tlsDir 'localhost.pem'
        $keyPath = Join-Path $tlsDir 'localhost-key.pem'
        $hasCert = Test-Path -LiteralPath $certPath
        $hasKey = Test-Path -LiteralPath $keyPath
        if ($hasCert -xor $hasKey) { throw 'Only one managed localhost TLS file exists. Setup will not overwrite a partial certificate pair; move both files aside after backing them up, then rerun.' }
        if ($hasCert) {
            Write-Step 'Validating the existing localhost certificate pair'
            $caRoot = (& $tools.Mkcert '-CAROOT' 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not $caRoot) { throw 'mkcert could not identify its CA directory. Repair mkcert, then rerun setup.' }
            $caPath = Join-Path $caRoot 'rootCA.pem'
            if (-not (Test-Path -LiteralPath $caPath -PathType Leaf)) { throw 'The existing mkcert root CA certificate is missing. Restore it or move the managed TLS pair aside after backing it up.' }
        } else {
            Write-Step 'Installing the local mkcert trust certificate and creating TLS files'
            [void](Invoke-Native $tools.Mkcert @('-install') 'Trusting the local mkcert CA')
            [void](Invoke-Native $tools.Mkcert @('-cert-file', $certPath, '-key-file', $keyPath, 'localhost', '127.0.0.1', '::1') 'Creating localhost TLS certificate')
            $caRoot = (& $tools.Mkcert '-CAROOT' 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not $caRoot) { throw 'mkcert could not identify its CA directory.' }
            $caPath = Join-Path $caRoot 'rootCA.pem'
        }
        if ($hasCert) {
            $null = Invoke-Helper $tools.Node $helper @('validate-tls', $certPath, $keyPath, $caPath) 'Validating localhost TLS certificate and CA'
            [void](Invoke-Native $tools.Mkcert @('-install') 'Trusting the existing local mkcert CA')
        }
        if (-not (Test-Path -LiteralPath $caPath -PathType Leaf)) { throw 'mkcert rootCA.pem is missing. Repair mkcert before continuing.' }
        Write-Step 'Creating the new companion pairing'
        $oldConfigDir = $env:FOUNDRY_MCP_CONFIG_DIR
        $oldPort = $env:FOUNDRY_MCP_PORT
        try {
            $env:FOUNDRY_MCP_CONFIG_DIR = $configDir
            $env:FOUNDRY_MCP_PORT = [string]$port
            [void](Invoke-Native $tools.Node @($cli, 'init', $origin, $certPath, $keyPath, $caPath) 'Creating configuration and pairing token')
        } finally {
            if ($null -eq $oldConfigDir) { Remove-Item Env:FOUNDRY_MCP_CONFIG_DIR -ErrorAction SilentlyContinue } else { $env:FOUNDRY_MCP_CONFIG_DIR = $oldConfigDir }
            if ($null -eq $oldPort) { Remove-Item Env:FOUNDRY_MCP_PORT -ErrorAction SilentlyContinue } else { $env:FOUNDRY_MCP_PORT = $oldPort }
        }
        Set-ManagedFileAcl $configPath
        $null = Get-ConfigSummary $tools.Node $helper 'validate-config' $configPath
    }

    Write-Step 'Checking whether the companion is already running'
    $probe = Get-ConfigSummary $tools.Node $helper 'probe-config' $configPath
    if ($probe.running -eq $true) { Write-Host 'A Foundry MCP companion is already listening; setup will not start a duplicate.'; $running = $true }
    else { $running = $false }

    Write-Step 'Creating connection and startup files'
    foreach ($artifactName in @('start-companion.ps1', 'check-status.ps1', 'foundry-mcp-client.json', 'foundry-mcp-codex.toml', 'pairing-instructions.txt')) {
        $artifactPath = Join-Path $OutputDirectory $artifactName
        if (Test-Path -LiteralPath $artifactPath) {
            $artifactItem = Get-Item -Force -LiteralPath $artifactPath
            if (($artifactItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Setup artifact is a link; refusing to write through it: $artifactPath" }
        }
    }
    $args = @('write-artifacts', '--node-path', $tools.Node, '--cli-path', $cli, '--config-dir', $configDir, '--output-dir', $OutputDirectory)
    [void](Invoke-Helper $tools.Node $helper $args 'Writing local setup artifacts')
    $startScript = Join-Path $OutputDirectory 'start-companion.ps1'
    $checkScript = Join-Path $OutputDirectory 'check-status.ps1'
    if (-not (Test-Path -LiteralPath $startScript -PathType Leaf) -or -not (Test-Path -LiteralPath $checkScript -PathType Leaf)) { throw 'The setup helper did not create the expected startup and status scripts.' }
    $pairing = Invoke-Helper $tools.Node $helper @('show-pairing', $configPath) 'Preparing the Foundry pairing details'
    try { $pairingDetails = $pairing | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'The setup helper returned invalid pairing details. Find pairing-instructions.txt in the setup folder and inspect it locally.' }
    Write-Host "`nPair the Foundry module with this local companion:" -ForegroundColor Yellow
    Write-Host "  Bridge URL: $($pairingDetails.endpoint)"
    Write-Host "  Pairing token: $($pairingDetails.token)"
    if (-not $NoDesktopShortcut -and $env:USERPROFILE) {
        try { New-DesktopShortcut $startScript (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Start Foundry MCP.lnk') }
        catch { Write-Warning 'Could not create a desktop shortcut. Use start-companion.ps1 in the setup folder instead.' }
    }

    if (-not $FoundryDataPath -and -not $NonInteractive) {
        $FoundryDataPath = Read-Host 'Optional: local Foundry Data folder path (leave blank for remote/Docker Foundry)'
    }
    if ($FoundryDataPath) {
        $data = Get-AbsolutePath $FoundryDataPath 'Foundry Data folder'
        if (-not (Test-Path -LiteralPath $data -PathType Container)) { throw 'The supplied Foundry Data folder does not exist. This must be a local folder visible to this PC.' }
        $moduleSource = Join-Path $project 'packages\module\dist'
        $target = Join-Path $data 'modules\foundry-vtt-mcp'
        if (-not (Test-Path -LiteralPath $moduleSource -PathType Container)) { throw 'The built Foundry module is missing from the source bundle.' }
        if (Test-Path -LiteralPath $target) {
            $targetItem = Get-Item -Force -LiteralPath $target
            if (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The target module folder is a link or junction. Setup will not copy files outside the Foundry data folder.' }
            $manifest = Join-Path $target 'module.json'
            if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'The target module folder exists but has no module.json. Setup will not replace it.' }
            try { $manifestData = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json -ErrorAction Stop }
            catch { throw 'The existing module manifest is unreadable. Setup will not replace it.' }
            if ($manifestData.id -ne 'foundry-vtt-mcp') { throw 'The target module folder belongs to a different module. Setup will not modify it.' }
        } else { [void][IO.Directory]::CreateDirectory($target) }
        $backup = Join-Path $OutputDirectory ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmssfff'))
        foreach ($name in @('module.js', 'module.json', 'module.css')) {
            $sourceFile = Join-Path $moduleSource $name
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Built module file is missing: $name" }
            $targetFile = Join-Path $target $name
            if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
                $targetFileItem = Get-Item -Force -LiteralPath $targetFile
                if (($targetFileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Existing module file is a link; refusing to copy outside the Foundry module folder: $targetFile" }
                [void][IO.Directory]::CreateDirectory($backup)
                Copy-Item -LiteralPath $targetFile -Destination (Join-Path $backup $name) -Force
            }
        }
        foreach ($name in @('module.js', 'module.json', 'module.css')) { Copy-Item -LiteralPath (Join-Path $moduleSource $name) -Destination (Join-Path $target $name) -Force }
        Write-Host "Installed the module locally to: $target"
    } else {
        $zip = Join-Path $project 'dist\foundry-vtt-mcp.zip'
        Write-Host "Foundry Data folder not supplied. Extract the module ZIP at $zip into the server's data/modules directory, or use your server's module installation process."
    }

    if (-not $NoStart -and -not $running) {
        Write-Step 'Starting the local companion'
        $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Start-Process -FilePath $windowsPowerShell -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $startScript)) -WorkingDirectory $OutputDirectory
    }
    Write-Host "`nSetup files: $OutputDirectory"
    Write-Host 'Finish setup in Foundry: enable Foundry MCP in the world, then set the bridge URL and pairing token shown in pairing-instructions.txt.'
    Write-Host 'Finish MCP client setup: add foundry-mcp-client.json or foundry-mcp-codex.toml to your client configuration and restart that client.'
    Write-Host 'The MCP client runs on the computer running the agent. Keep the local companion running on the computer that can reach Foundry.'
    if ($script:SetupRestartRequired) { Write-Warning 'Restart Windows after setup to complete prerequisite installation.' }
}

if ($MyInvocation.InvocationName -ne '.') {
    $portWasExplicit = $PSBoundParameters.ContainsKey('Port')
    try { Invoke-Setup $portWasExplicit; exit 0 }
    catch { Write-Error $_.Exception.Message; exit 1 }
}
