const { exec } = require('child_process')
const fs = require('fs')
const readline = require('readline')

var tmp_dir = ""
var configs_dir = ""
var file_lines = []
var configs = {}
var config = {}

exports.init = function (path, wg_config, tmp_path, callback) {
    config = wg_config
    configs_dir = path
    tmp_dir = tmp_path
    // check if config exists
    fs.stat(configs_dir+'wg0.conf', function(err, stat) {
        if (err) {
            // create server config
            fs.writeFile(configs_dir+'wg0.conf',
            '### GENERATED BY KEUKNET, DO NOT EDIT ###\n'+
            '[Interface]\n'+
            `PrivateKey = ${config.privkey}\n`+
            `Address = ${config.subnet}1${config.subnet_mask}\n`+
            `MTU = ${config.mtu}\n`+
            `ListenPort = ${config.port}\n`+
            `PostUp = iptables -I FORWARD -i %i -d 0.0.0.0/0 -j DROP\n`+
            `PostDown = iptables -D FORWARD -i %i -d 0.0.0.0/0 -j DROP\n`+
            `PostUp = ip6tables -I FORWARD -i %i -d ::/0 -j DROP && ip6tables -I FORWARD -i %i -d ${config.subnet+config.subnet_mask} -j ACCEPT\n`+
            `PostDown = ip6tables -D FORWARD -i %i -d ::/0 -j DROP && ip6tables -D FORWARD -i %i -d ${config.subnet+config.subnet_mask} -j ACCEPT\n`,
            function (err) {
                if (err) return callback(err)
                __start_server(function (err) {
                    return callback(err)
                })
            })
        }
        __start_server(function (err) {
            return callback(err)
        })
    })
}

function __start_server(callback) {
    // start wireguard
    exec('wg-quick down wg0')
    exec(`wg-quick up ${configs_dir}wg0.conf`, function (err, _, stderr) {
        if (err || stderr) {
            return callback(err ?? stderr)
        }
    })
    // collect all configs in server config
    __init_server_config(function () {
        return callback()
    })
}

function __init_server_config(callback) {
    // create interface for reading line by line
    var file = readline.createInterface({
        input: fs.createReadStream(configs_dir+'wg0.conf', 'utf8')
    })
    // collect all configs their positions
    file.on('line', function (line) {
        file_lines.push(line)
    })
    file.on('close', function () {
        __index_configs()
        return callback()
    })
}

function __index_configs() {
    configs = {}
    var current = {}
    file_lines.forEach(function(line, index) {
        if (line.startsWith('### begin ')) {
            current['name'] = line.slice(10,-4)
            current['start'] = index
            return
        }
        if (line.startsWith('### end ')) {
            current['end'] = index
            configs[current['name']] = {
                start:current['start'],
                end:current['end']
            }
            return
        }
    })
}

/**
 * Saves the config stored in *file_lines* to it's config file,
 * and reloads wireguard.
 * Has no parameters or returns.
 */
function __save_config() {
    var file = fs.createWriteStream(configs_dir+"wg0.conf")
    file_lines.forEach(function(line) {
        file.write(line+'\n')
    })
    file.end()
    __index_configs()
    // reload wireguard
    exec(`wg-quick strip wg0 >${tmp_dir}/wg0.conf && wg syncconf wg0 ${tmp_dir}/wg0.conf`, function (err, _, stderr) {
        if (err || stderr) console.log(err, stderr)
    })
}

/**
 * Removes the profile from the server config and deletes it's config file.
 * @param {UUID} uuid The uuid of the profile to remove
 * @param {Function} callback the callback to call when done
 */
function __remove(uuid, callback) {
    loc = configs[uuid]
    if (!loc) return callback()
    // remove from server config
    amount = loc.end - loc.start +1
    file_lines.splice(loc.start, amount)
    __save_config()
    // delete config file if still exists
    fs.unlink(`${configs_dir+uuid}.conf`, function (err) {
        return callback()
    })
}

/**
 * Adds the profile to the server config and creates a config file for it.
 * @param {UUID} uuid the uuid of the profile to add
 * @param {String} pubkey the public key of the profile
 * @param {String} prekey the pre-shared key of the profile
 * @param {String} privkey the private key of the profile
 * @param {String} ip the ip-address of the profile
 * @param {Function} callback the callback to call when done
 */
function __add(uuid, pubkey, prekey, privkey, ip, callback) {
    if (configs[uuid]) return callback()
    // append to server config
    file_lines.push(
        `### begin ${uuid} ###`,
        "[Peer]",
        `PublicKey = ${pubkey}`,
        `PresharedKey = ${prekey}`,
        `AllowedIPs = ${ip}/128`,
        `### end ${uuid} ###`
    )
    __save_config()
    // create client config
    fs.writeFile(`${configs_dir+uuid}.conf`,
        '[Interface]\n'+
        `PrivateKey = ${privkey}\n`+
        `Address = ${ip+config.subnet_mask}\n`+
        `DNS = ${config.dns_server}\n`+
        '[Peer]\n'+
        `PublicKey = ${config.pubkey}\n`+
        `PresharedKey = ${prekey}\n`+
        `Endpoint = ${config.endpoint}:${config.port}\n`+
        `AllowedIPs = ${config.subnet+config.subnet_mask}\n`,
    function (err) {
        return callback()
    }) 
}

exports.create = function (uuid, ip, callback) {
    ip = config.subnet + ip.toString(16)
    
    exec("wg genkey", function (err, priv, stderr) {
        if (err) return callback(undefined, err)
        priv = priv.split('\n')[0]
        exec(`echo ${priv} | wg pubkey`, function (err, pub, stderr) {
            if (err) return callback(undefined, err)
            pub = pub.split('\n')[0]
            exec("wg genpsk", function (err, pre, stderr) {
                if (err) return callback(undefined, err)
                pre = pre.split('\n')[0]
                __add(uuid, pub, pre, priv, ip, function () {
                    return callback(ip)
                })
            })
        })
    })
}

exports.delete = function (uuid, callback) {
    __remove(uuid, function () {
        return callback()
    })
}

exports.getConfig = function (uuid, callback) {
    fs.readFile(`${configs_dir+uuid}.conf`, 'utf8', function (err, data) {
        if (err) return callback(undefined, err)
        fs.unlink(`${configs_dir+uuid}.conf`, function (err) {
            if (err) return callback(undefined, err)
        })
        return callback(data, undefined)
    })
}
