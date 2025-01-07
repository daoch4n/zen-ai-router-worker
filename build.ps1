try {
    npx wrangler deploy
} catch {
    Write-Host "An error occurred: $_"
    pause
}
