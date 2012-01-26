#!node

var fs = require("fs");
var uuid = require("node-uuid");
var AzureMgt = require("./azure-management");
var PublishHelper = require("./publish-helper");
var Path = require("path");
var packager = require("./azure-packager-node");
var argumentHandler = require("./argument-handler");
var child_process = require("child_process");

var program = require('commander');

program
    .option('-p, --publish [serviceName]', 'publish the service')
    .option('-po, --portal', 'opens the Azure management portal')
    .option('-d, --download', 'download publish settings')
    .option('-l, --locations', 'list all datacenter locations')
    .option('-de, --debug', 'output debug messages')
    .parse(process.argv);

if (program.portal) {
    argumentHandler.openPortal(function(err) {
        if (err) {
            console.log(err);
        }
    });
}
else if (program.download) {
    argumentHandler.downloadPublishSettings(function(err) {
        if (err) {
            return console.log(err);
        }
    });
}
else if (program.locations) {
    getAzureMgt(function (err, azureMgt) {
        
        azureMgt.getDatacenterLocations(function (err, locs) {
            if (err) return console.log(err);
            
            var data = locs.join("\n");
            
            console.log(data);
        });
        
    });
}
else if (program.publish) { 
    if (program.publish === true) {
        console.log("error: service name is required, specify '-p servicename'");
        return;
    }
    
    /* // you can update the config of a deployment like this:
    azureMgt.upgradeConfiguration(program.publish, "production", { instanceCount: 2 }, function (reqId) {
        azureMgt.monitorStatus(reqId, function (err) {
            console.log("config update", err);
        });
    });
    */
                    
    getAzureMgt(function (err, azureMgt) {
        if (err) return console.log("getAzureMgt failed", err);
        
        var publish = new PublishHelper(azureMgt);
        
        console.log("creating package for './apps/" + program.publish + "'");
        packager("./apps/" + program.publish, "./build_temp/" + uuid.v4(), function (err, file) {
            if (err) return console.log("packaging failed", err);
            
            publish.uploadPackage(file, function (err, pkg) {
                if (err) { 
                    return console.log("uploadPackage failed", err);
                }
                
                console.log("package uploaded", pkg);
                
                fs.unlink(file, function (err) {
                    console.log("package removed from filesystem", err);
                });
                
                // specify the (default) config settings, they will be set if a new deployment is created
                // otherwise use 'upgradeConfiguration([service], [slot], [config], [callback])'
                var defaultConfig = {
                    operatingSystem: azureMgt.constants.OS.WIN2008_SP2,
                    instanceCount: 1
                };
                
                publish.publishPackage(pkg, program.publish, defaultConfig, function (err) {
                    if (err) {
                        return console.log("publish error", err);
                    }
                    else {
                        return console.log("publish succeeded");
                    }
                    
                    publish.waitForServiceToBeStarted(program.publish, function (err, url) {
                        if (err) return console.log("waitForServiceToBeStarted failed");
                        
                        console.log("Service running and available on " + url);
                    });
                });
            });
        });    
    });
}
else {
    console.log(program.helpInformation());
}

/**
 * Get an instance of AzureMgt based on the settings in a publishSettings file in the root of this app
 */
function getAzureMgt(callback) {
    var files = fs.readdirSync("./");
    
    //find settings files
    var settingsFiles = files.filter(function(value, index, object) {
        if (value.match(/\.publishsettings$/)) {
            return true;
        }
    });

    //if not settings file was found then display an error
    if (settingsFiles.length == 0) {
        console.log("publish settings file (.publishsettings) is required in the root of the application. To download use azure -d");
        return;
    }

    //grab the first one
    var settingsFile = settingsFiles[0];
    console.log("using settings file:", settingsFile);
    
    // read it
    var sett = fs.readFileSync(settingsFile, "ascii");
    
    getCertAndKey(sett, function (err, cert, key) {
        if (err) return callback(err);
        
        var azureMgt = new AzureMgt(sett, cert, key, program.debug);
        callback(null, azureMgt);
    });
}

/**
 * Extract the private key from an Azure Management Certificate
 */
function getCertAndKey(sett, callback) {
    var file = Path.join(process.cwd(), "/build_temp/", uuid.v4() + ".key");
    
    AzureMgt.parsePublishSettings(sett, function (err, data) {
        if (err) return callback(err);
    
        var buffer = new Buffer(data.certificate, 'base64');
        
        fs.writeFile(file, buffer, function (err) {
            if (err) return callback(err);
            
            child_process.exec('openssl pkcs12 -in ' + file + ' -nodes -passin pass:', function (err, key) {
                if (err) return callback(err);
                
                fs.unlink(file);
                
                callback(null, key, key);
            });
        });
    });
}