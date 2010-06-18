// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

// A simple class to represent a database. Uses XMLHttpRequest to interface with
// the CouchDB server.

function CouchDB(name, httpHeaders) {
  this.name = name;
  this.uri = "/" + encodeURIComponent(name) + "/";

  this.request = function(method, uri, callback,requestOptions) {
      requestOptions = requestOptions || {}
      requestOptions.headers = combine(requestOptions.headers, httpHeaders)
      return CouchDB.request(method, uri, callback, requestOptions);
    }

  // Creates the database on the server
  this.createDb = function(okCallback, errorCallback) {
    var callback = function(req) {
      okCallback.call(this, JSON.parse(req.responseText) );
    }
    this.request("PUT", this.uri, CouchDB.maybeThrowError(okCallback, errorCallback));
  }

  // Deletes the database on the server
  this.deleteDb = function(okCallback, errorCallback) {
    var callback = function(req) {
      var arg;
      if ( req.status == 404 )
        arg = false
      else
        arg = JSON.parse(req.responseText);
      return okCallback.call(this, arg);
    }
    
    return this.request("DELETE", this.uri, CouchDB.maybeThrowError(okCallback, errorCallback));
  }

  // Save a document to the database
  this.save = function(okCallback, doc, options, errorCallback) {
    var callback = function(req) {
      var result = JSON.parse(req.responseText);
      doc._rev = result.rev;
      return okCallback.call(this, result);
    };

    var uuidCallback = function(uuids) {
        doc._id = uuids[0];
        return put.call(this, doc);
    }

    var put = function(doc) {
      return this.request("PUT", this.uri + encodeURIComponent(doc._id) + encodeOptions(options), 
        CouchDB.maybeThrowError(callback, errorCallback, this), {body: JSON.stringify(doc)});
    }

    if (doc._id == undefined)
        return CouchDB.newUuids(uuidCallback, 1, errorCallback, this);
    else
        return put.call(this, doc);
  }

  // Open a document from the database
  this.open = function(okCallback, docId, options, errorCallback) {
    var callback = function(req) {
      var arg;
      if (req.status == 404)
        arg = null;
      else
        arg = JSON.parse(req.responseText);
    
      return okCallback.call(this, arg);
    }
  
    return this.request("GET", this.uri + encodeURIComponent(docId) + encodeOptions(options),
      CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  // Deletes a document from the database
  this.deleteDoc = function(okCallback, doc, errorCallback) {
    var callback = function(req) {
      var result = JSON.parse(req.responseText);
      doc._rev = result.rev; //record rev in input document
      doc._deleted = true;
      return okCallback.call(this, result);
    }
  
    return this.request("DELETE", this.uri + encodeURIComponent(doc._id) + "?rev=" + doc._rev,
      CouchDB.maybeThrowError(okCallback, errorCallback, this));
  }

  // Deletes an attachment from a document
  this.deleteDocAttachment = function(okCallback, doc, attachment_name, errorCallback) {
    var callback = function(req) {
      var result = JSON.parse(req.responseText);
      doc._rev = result.rev; //record rev in input document
      return okCallback.call(this, result);
    }
    
    return this.request("DELETE", this.uri + encodeURIComponent(doc._id) + "/" + attachment_name + "?rev=" + doc._rev,
      CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  this.bulkSave = function(okCallback, docs, options, errorCallback) {
    var callback = function(req) {
      if (this.last_req.status == 417) {
        return {errors: JSON.parse(req.responseText)};
      }
      else {
        var results = JSON.parse(req.responseText);
        for (var i = 0; i < docs.length; i++) {
          if(results[i].rev)
            docs[i]._rev = results[i].rev;
        }
        okCallback.call(this, results);
      }
    }
  
    // first prepoulate the UUIDs for new documents
    var newCount = 0
    for (var i=0; i<docs.length; i++) {
      if (docs[i]._id == undefined)
        newCount++;
    }
    
    var uuidCallback = function(newUuids) {
      var newCount = 0
      for (var i=0; i<docs.length; i++) {
        if (docs[i]._id == undefined)
          docs[i]._id = newUuids.pop();
      }

      var json = {"docs": docs};
      // put any options in the json
      for (var option in options) {
        json[option] = options[option];
      }
      
      this.request("POST", this.uri + "_bulk_docs", CouchDB.maybeThrowError(callback, errorCallback, this), {
        body: JSON.stringify(json),
      });
    }
    
    return CouchDB.newUuids(uuidCallback, docs.length, errorCallback, this);
  }

  this.ensureFullCommit = function(okCallback, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText));
    }
    return this.request("POST", this.uri + "_ensure_full_commit",
      CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  // Applies the map function to the contents of database and returns the results.
  this.query = function(okCallback, mapFun, reduceFun, options, keys, language, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }
    
    var body = {language: language || "javascript"};
    if(keys) {
      body.keys = keys ;
    }
    if (typeof(mapFun) != "string")
      mapFun = mapFun.toSource ? mapFun.toSource() : "(" + mapFun.toString() + ")";
    body.map = mapFun;
    if (reduceFun != null) {
      if (typeof(reduceFun) != "string")
        reduceFun = reduceFun.toSource ? reduceFun.toSource() : "(" + reduceFun.toString() + ")";
      body.reduce = reduceFun;
    }
    if (options && options.options != undefined) {
        body.options = options.options;
        delete options.options;
    }
    return this.request("POST", this.uri + "_temp_view" + encodeOptions(options), 
      CouchDB.maybeThrowError(callback, errorCallback, this), {
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
    });
  }

  this.view = function(okCallback, viewname, options, keys, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText));
    }
  
    var viewParts = viewname.split('/');
    var viewPath = this.uri + "_design/" + viewParts[0] + "/_view/"
        + viewParts[1] + encodeOptions(options);
    if(!keys) {
      return this.request("GET", viewPath, CouchDB.maybeThrowError(callback, errorCallback, this));
    } else {
      return this.request("POST", viewPath, CouchDB.maybeThrowError(callback, errorCallback, this), {
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({keys:keys})
      });
    }
  }

  // gets information about the database
  this.info = function(okCallback, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(this.last_req.responseText));
    }
  
    return this.request("GET", this.uri, CouchDB.maybeThrowError(callback, errorCallback));
  }

  // gets information about a design doc
  this.designInfo = function(docid) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(this.last_req.responseText), CouchDB.maybeThrowError(callback, errorCallback));
    }

    return this.request("GET", this.uri + docid + "/_info");
  }

  this.viewCleanup = function() {
    this.last_req = this.request("POST", this.uri + "_view_cleanup");
    CouchDB.maybeThrowError(this.last_req);
    return JSON.parse(this.last_req.responseText);
  }


  this.allDocs = function(okCallback, options, keys, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    if(!keys) {
      return this.request("GET", this.uri + "_all_docs" + encodeOptions(options), CouchDB.maybeThrowError(callback, errorCallback, this));
    } else {
      return this.request("POST", this.uri + "_all_docs" + encodeOptions(options), CouchDB.maybeThrowError(callback, errorCallback, this), {
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({keys:keys})
      });
    }
  }

  this.designDocs = function(okCallback, errorCallback) {
    return this.allDocs(okCallback, {startkey:"_design", endkey:"_design0"}, undefined, errorCallback);
  };

  this.allDocsBySeq = function(okCallback, options, keys, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }
      
    if(!keys) {
      return this.request("GET", this.uri + "_all_docs_by_seq" + encodeOptions(options), CouchDB.maybeThrowError(callback, errorCallback, this));
    } else {
      return this.request("POST", this.uri + "_all_docs_by_seq" + encodeOptions(options), CouchDB.maybeThrowError(callback, errorCallback, this), {
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({keys:keys})
      });
    }
  }

  this.compact = function(okCallback, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    return this.request("POST", this.uri + "_compact", CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  this.setDbProperty = function(okCallback, propId, propValue, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    return this.request("PUT", this.uri + propId, CouchDB.maybeThrowError(callback, errorCallback, this), {
      body:JSON.stringify(propValue)
    });
  }

  this.getDbProperty = function(okCallback, propId, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    return this.request("GET", this.uri + propId, CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  this.setAdmins = function(okCallback, adminsArray, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    return this.request("PUT", this.uri + "_admins", CouchDB.maybeThrowError(callback, errorCallback, this), {
      body:JSON.stringify(adminsArray)
    });
  }

  this.getAdmins = function(okCallback, errorCallback) {
    var callback = function(req) {
      return okCallback.call(this, JSON.parse(req.responseText) );
    }

    return this.request("GET", this.uri + "_admins", CouchDB.maybeThrowError(callback, errorCallback, this));
  }

  // Convert a options object to an url query string.
  // ex: {key:'value',key2:'value2'} becomes '?key="value"&key2="value2"'
  function encodeOptions(options) {
    var buf = []
    if (typeof(options) == "object" && options !== null) {
      for (var name in options) {
        if (!options.hasOwnProperty(name)) continue;
        var value = options[name];
        if (name == "key" || name == "startkey" || name == "endkey") {
          value = toJSON(value);
        }
        buf.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
      }
    }
    if (!buf.length) {
      return "";
    }
    return "?" + buf.join("&");
  }

  function toJSON(obj) {
    return obj !== null ? JSON.stringify(obj) : null;
  }

  function combine(object1, object2) {
    if (!object2)
      return object1;
    if (!object1)
      return object2;

    for (var name in object2)
      object1[name] = object2[name];

    return object1;
  }


}

CouchDB.server = "";

CouchDB.login = function(okCallback, username, password, errorCallback) {
  var callback = function(req) {
    return okCallback.call(this, JSON.parse(req.responseText) );
  }

  return CouchDB.request("POST", "/_session", CouchDB.maybeThrowError(callback, errorCallback, this), {
    headers: {"Content-Type": "application/x-www-form-urlencoded",
      "X-CouchDB-WWW-Authenticate": "Cookie"},
    body: "username=" + encodeURIComponent(username) + "&password=" + encodeURIComponent(password)
  });
}

CouchDB.logout = function(okCallback, errorCallback) {
  var callback = function(req) {
    return okCallback.call(this, JSON.parse(req.responseText) );
  }

  return CouchDB.request("DELETE", "/_session", CouchDB.maybeThrowError(callback, errorCallback, this), {
    headers: {"Content-Type": "application/x-www-form-urlencoded",
      "X-CouchDB-WWW-Authenticate": "Cookie"}
  });
}

CouchDB.createUser = function(okCallback, username, password, email, roles, basicAuth, errorCallback) {
  var callback = function(req) {
    return okCallback.call(this, JSON.parse(req.responseText) );
  }
  
  var roles_str = ""
  if (roles) {
    for (var i=0; i< roles.length; i++) {
      roles_str += "&roles=" + encodeURIComponent(roles[i]);
    }
  }
  var headers = {"Content-Type": "application/x-www-form-urlencoded"};
  if (basicAuth) {
    headers['Authorization'] = basicAuth
  } else {
    headers['X-CouchDB-WWW-Authenticate'] = 'Cookie';
  }

  return CouchDB.request("POST", "/_user/", CouchDB.maybeThrowError(callback, errorCallback, this), {
    headers: headers,
    body: "username=" + encodeURIComponent(username) + "&password=" + encodeURIComponent(password)
          + "&email="+ encodeURIComponent(email)+ roles_str

  });
}

CouchDB.updateUser = function(okCallback, username, email, roles, password, old_password, errorCallback) {
  var callback = function(req) {
    return okCallback.call(this, JSON.parse(req.responseText) );
  }

  var roles_str = ""
  if (roles) {
    for (var i=0; i< roles.length; i++) {
      roles_str += "&roles=" + encodeURIComponent(roles[i]);
    }
  }

  var body = "email="+ encodeURIComponent(email)+ roles_str;

  if (typeof(password) != "undefined" && password)
    body += "&password=" + password;

  if (typeof(old_password) != "undefined" && old_password)
    body += "&old_password=" + old_password;

  return CouchDB.request("PUT", "/_user/"+encodeURIComponent(username), CouchDB.maybeThrowError(callback, errorCallback, this), {
    headers: {"Content-Type": "application/x-www-form-urlencoded",
      "X-CouchDB-WWW-Authenticate": "Cookie"},
    body: body
  });
}

CouchDB.allDbs = function(okCallback, errorCallback) {
  var callback = function(req) { return okCallback.call(this, JSON.parse(req.responseText) ); }
  return CouchDB.request("GET", "/_all_dbs",
    CouchDB.maybeThrowError(callback, errorCallback));
}

CouchDB.allDesignDocs = function(okCallback, errorCallback) {
  var callback = function(dbs) {
    var ddocs = {};
    var pendingRequests = dbs.length;

    for (var i=0; i < dbs.length; i++) {
      var db = new CouchDB(dbs[i]);
      db.designDocs(function(dds) {
        pendingRequests--;
        ddocs[this.name] = dds;

        if (pendingRequests == 0)
          okCallback.call(this, ddocs);
      }, errorCallback, dbs[i]);
    };
  }

  return CouchDB.allDbs(callback, errorCallback);
};

CouchDB.getVersion = function(okCallback, errorCallback) {
  var callback = function(req) { return okCallback( JSON.parse(req.responseText).version ); };
  return CouchDB.request("GET", "/", CouchDB.maybeThrowError(callback, errorCallback));
}

CouchDB.replicate = function(okCallback, source, target, rep_options, errorCallback) {
  var callback = function(req) { return okCallback.call(this, JSON.parse(req.responseText) ); }
  
  rep_options = rep_options || {};
  var headers = rep_options.headers || {};
  return CouchDB.request("POST", "/_replicate", CouchDB.maybeThrowError(callback, errorCallback, this), {
    headers: headers,
    body: JSON.stringify({source: source, target: target})
  });
}

CouchDB.newXhr = function() {
  if (typeof(XMLHttpRequest) != "undefined") {
    return new XMLHttpRequest();
  } else if (typeof(ActiveXObject) != "undefined") {
    return new ActiveXObject("Microsoft.XMLHTTP");
  } else {
    throw new Error("No XMLHTTPRequest support detected");
  }
}

CouchDB.request = function(method, uri, callback, options) {
  options = options || {};
  var req = CouchDB.newXhr();
  req.open(method, this.server+uri, /*async=*/true);
  if (options.headers) {
    var headers = options.headers;
    for (var headerName in headers) {
      if (!headers.hasOwnProperty(headerName)) continue;
      req.setRequestHeader(headerName, headers[headerName]);
    }
  }
  req.onreadystatechange = function() { if (req.readyState == 4) return callback.call(this, req) };

  req.send(options.body || "");
}

CouchDB.requestStats = function(okCallback, module, key, test, errorCallback) {
  var callback = function(req) { return okCallback.call(this, JSON.parse(req.responseText)[module][key] ); }
  
  var query_arg = "";
  if(test !== null) {
    query_arg = "?flush=true";
  }

  return CouchDB.request("GET", "/_stats/" + module + "/" + key + query_arg, CouchDB.maybeThrowError(callback, errorCallback, this));
}

CouchDB.uuids_cache = [];

CouchDB.newUuids = function(okCallback, n, errorCallback, caller) {
  if (!caller)
    caller = this;
  
  if (CouchDB.uuids_cache.length >= n) {
    var uuids = CouchDB.uuids_cache.slice(CouchDB.uuids_cache.length - n);
    if(CouchDB.uuids_cache.length - n == 0) {
      CouchDB.uuids_cache = [];
    } else {
      CouchDB.uuids_cache =
          CouchDB.uuids_cache.slice(0, CouchDB.uuids_cache.length - n);
    }
    return okCallback.call(caller, uuids);
  } else {
    var callback = function(req) {
      var result = JSON.parse(req.responseText);
      CouchDB.uuids_cache =
        CouchDB.uuids_cache.concat(result.uuids.slice(0, 100));
      
      return okCallback.call(caller, result.uuids.slice(100));
    }

    return CouchDB.request("GET", "/_uuids?count=" + (100 + n), CouchDB.maybeThrowError(callback, errorCallback, caller));
  }
}

CouchDB.maybeThrowError = function(okCallback, errorCallback, caller) {
  return function(req) {
    if (!caller)
      caller = this;
  
    if (req.status >= 400) {
      try {
        var result = JSON.parse(req.responseText);
      } catch (ParseError) {
        var result = {error:"unknown", reason:req.responseText};
      }
      if (errorCallback)
        return errorCallback(req);
      else if (this.errorCallback)
        return this.errorCallback(caller, req);
    }
    else
      return okCallback.call(caller, req);
  };
}

CouchDB.params = function(options) {
  options = options || {};
  var returnArray = [];
  for(var key in options) {
    var value = options[key];
    returnArray.push(key + "=" + value);
  }
  return returnArray.join("&");
}
