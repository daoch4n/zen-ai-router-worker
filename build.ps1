try {
    Remove-Item -Recurse -Force -Path .\output\
    npx wrangler deploy --dry-run --outdir output
    npx terser output\worker.js -o output\worker.js --comments false
    node .\obfuscate.mjs
    $randomGuid = [guid]::NewGuid().ToString()
    Compress-Archive -Path .\output\_worker.js -DestinationPath ".\output\worker-$randomGuid.zip" -Force
} catch {
    Write-Host "An error occurred: $_"
    pause
}
