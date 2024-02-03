/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
var endpoints = [
    'index','logout','login',
    'register'
]
var extensions = [
    'profile','servers','nothing',
    'admin'
]

var indices = {}
var extension_indices = {}
var fetch, content, favicons, data, ip_scope, cuts, nj
exports.init = function (global) {
    ({fetch,content,favicons,data,ip_scope,cuts,nj} = global)

    for (path of endpoints) {
        indices[path] = require('./endpoints/'+path)
        indices[path].init(global)
    }
    for (path of extensions) {
        extension_indices[path] = require(`./extensions/${path}/index.js`)
        extension_indices[path].init(global)
    }
    extensions.splice(extensions.indexOf('admin'))
}

exports.main = function (req, res) {
    var location = req.path.shift() || (req.headers.authorization ? 'profile' : '~index')
    var filetype = location.split('.')[1] ?? location.startsWith('~')

    // If endpoint
    if (!filetype) {
        // set request context
        req.context = {...req.args}
        req.context.extensions = [...extensions]
        req.context.connected = req.ip.startsWith(ip_scope)
    
        // Authenticate using user&pass, else using ip
        data.authenticate(req.headers.authorization, req.ip, ip_scope, function (user, err) {
            req.context.user = user
            if (err) req.context.auth_err = err
            if (user && user.is_admin) req.context.extensions.push('admin')
        
            // Default endpoint
            if (endpoints.includes(location)) {
                indices[location].main(req, res)
            }
            // Extension
            else if (req.context.extensions.includes(location)) {
                // If login required
                if (!user && extension_indices[location].requires_login(req.path)) {
                        res.writeHead(307, {Location: "/login"})
                        res.end()
                        return
                }
                extension_indices[location].main(req, res)
            }
            else {
                res.writeHead(404)
                res.end()
            }
        })
    }
    else {
        // Templated html
        if (location.startsWith('~')) {
            cuts.end_nj(req, res, 'content/'+location.split('~')[1])
        }
        // Favicon
        else if (favicons.includes(location)) {
            var filetype = 
            fetch.file(`favicons${req.url}`, function (data, err) {
                if (err) {
                    res.writeHead(404)
                    res.end()
                    return
                }
                res.writeHead(200, content[filetype])
                res.end(data)
            })
        }
        // if location is a file
        else {
            var filetype = req.url.split('.').pop()
            fetch.file(req.url, function (data, err) {
                if (err) {
                    res.writeHead(404)
                    res.end()
                    return
                }
                res.writeHead(200, content[filetype])
                res.end(data)
            })
        }
    }
}
