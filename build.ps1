try {
    npx wrangler deploy --env production --minify
} catch {
    Write-Host "An error occurred: $_"
    pause
}
