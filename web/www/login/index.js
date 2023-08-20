exports.main = function (req, res, global) {
    const {data} = global
    if (data.authenticate(req.headers.authorization)) {
        res.writeHead(307, {"Location": "/"})
        res.end()
        return
    }
    res.writeHead(401, {"WWW-Authenticate": "Basic"})
    res.end(`<html><head><script>
    window.onload = function() {
    window.location.replace("https://${req.headers.host}/");}
    </script></head></html>`)
}