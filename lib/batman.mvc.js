if (!exports)
    var exports = {};

(function() {
    
    // App
    
    var appRequire = function(prefix) {
        return function(array) {
            if (!Array.isArray(array))
                array = [array];
            
            if (!array.length)
                return;
            
            if (this[prefix + 'Path'])
                prefix = this[prefix + 'Path'];
            else if (this.requirePath)
                prefix = this.requirePath + '/' + prefix;
            
            if (prefix.substr(-1) !== '/')
                prefix += '/';
            
            var i = array.length;
            while (i--)
                array[i] = prefix + array[i] + '.js';
            
            var ready = this.ready;
            ready.prevent();
            
            setTimeout(function() {
                Batman.require(array, function() {
                    ready.allow();
                    
                    if (ready.allowed())
                        ready();
                });
            }, 0);
        };
    };
    
    Batman.App = Batman.Mixin({
        isApp: true,
        controllers: Batman.binding([]).observeForever(appRequire('controllers')),
        models: Batman.binding([]).observeForever(appRequire('models')),
        views: Batman.binding([]).observeForever(appRequire('views')),
        
        ready: Batman.event(null, true),
        
        run: Batman.event(function() {
            if (!this.controllers && !this.models && !this.views)
                this.ready();
            
            if (!this.ready.allowed()) {
                this.ready(function(){this.run();}.bind(this));
                return false;
            }
            
            if (typeof this.mainView === 'undefined' && document && document.body)
                this.mainView = Batman.View({node: document.body});
            
            this.route();
            
            if (this.AppController && this.AppController.appDidRun)
                this.AppController.appDidRun();
        }),
        
        route: Batman.event(function() {
            function hashChanged(e) {
                var hash = window.location.hash;
                hash = hash.substr(Batman.Controller.routePrefix.length);
                
                Batman.Controller.route(hash || '/');
            }
            
            var oldHash = window.location.hash;
            function checkHashChange() {
                var hash = window.location.hash;
                
                if (hash !== oldHash) {
                    oldHash = hash;
                    hashChanged();
                }
            }
            
            if ('onhashchange' in window)
                window.addEventListener('hashchange', hashChanged);
            else
                setInterval(checkHashChange, 250);
            
            if (Batman.Controller.routes.length)
                hashChanged();
        }),
    });
    
    // Controller
    
    // route matching courtesy of Backbone
    var namedParam    = /:([\w\d]+)/g;
    var splatParam    = /\*([\w\d]+)/g;
    var namedOrSplat  = /[:|\*]([\w\d]+)/g;
    var escapeRegExp  = /[-[\]{}()+?.,\\^$|#\s]/g;

    
    Batman.Controller = Batman.Mixin({
        isController: true,
        
        initialize: function() {
            if (this.identifier)
                Batman.Controller.controllers[this.identifier] = this;
        },
        
        render: function(options) {
            options = options || {};
            
            if (options.template)
                options.view = Batman.View({template: options.template});
            else if (options.text) {
                var node = document.createElement('div');
                node.innerHTML = options.text;
                
                options.view = Batman.View({node: node});
            }
            
            if (!options.view && this.currentRoute) {
                var cached = this.currentRoute._cachedView;
                if (cached)
                    options.view = cached;
            }
            
            if (!options.view)
                options.view = Batman.View({template: [this.identifier, this.action].join('/')});
            
            if (this.currentRoute)
                this.currentRoute._cachedView = options.noCache ? null : options.view;
            
            options.view.ready(function() {
                Batman.DOM.bindings.contentFor('main', options.view.node());
            });
        }
    }).mixin({
        controllers: {},
        
        routePrefix: '#!',
        ignoreInvalidRoutes: false,
        
        route: Batman.binding().observe(function(match) {
            window.location.hash = this.routePrefix + match;
            
            if (!this._routeFunctionCalled) {
                var route = this.matchRoute(match);
                if (route)
                    route.dispatch(this.extractParams(match, route));
                
                else if (!this.ignoreInvalidRoutes)
                    this.route('/404');
            }
            
            this._routeFunctionCalled = false;
        }),
        
        _routeFunctionCalled: false,
        
        routes: [],
        addRoute: function(match, route) {
            Batman.Route.applyTo(route);
            route.match = match = match.replace(escapeRegExp, '\\$&');
            route.regexp = new RegExp('^' + match.replace(namedParam, '([^\/]*)').replace(splatParam, '(.*?)') + '$');
            
            var array, paramNames = route.paramNames;
            while ((array = namedOrSplat.exec(match)) !== null)
                array[1] && paramNames.push(array[1]);
            
            this.routes.push(route);
            return route;
        },
        
        matchRoute: function(match) {
            var routes = this.routes, route;
            for (var i = -1, count = routes.length; ++i < count;) {
                route = routes[i];
                
                if (route.regexp.test(match))
                    return route;
            }
        },
        
        extractParams: function(match, route) {
            var array = route.regexp.exec(match).slice(1),
                params = {};
            
            for (var i = -1, count = array.length; ++i < count;)
                params[route.paramNames[i]] = array[i];
            
            return params;
        }
    });
    
    Batman.route = function(match, func) {
        var route = function(params) {
            var string = route.match;
            if (params)
                for (var key in params)
                    string = string.replace(new RegExp('[:|\*]' + key), params[key]);
            
            Batman.Controller._routeFunctionCalled = true;
            Batman.Controller.route(string);
            
            return route.dispatch(params);
        };
        
        if (func && func.isModel)
            func.identifier = match;
        
        Batman.Controller.addRoute(match, route);
        route.action = func;
        
        return route;
    };
    
    Batman.currentRoute = Batman.Controller.route;
    var currentRoute;
    
    Batman.Route = Batman.Mixin({
        _configureOnMixin: true,
        configure: function(object, key) {
            delete this._configureOnMixin;
            
            this.context = object;
            return this;
        },
        
        isRoute: true,
        isCurrent: $binding(false),
        
        action: null,
        match: '',
        regexp: null,
        
        paramNames: [],
        
        dispatch: function(params) {
            currentRoute && currentRoute.isCurrent(false);
            
            currentRoute = this;
            currentRoute.isCurrent(true);
            
            var context = this.context;
            if (context && context.isController) {
                context.currentRoute = this;
                
                for (var key in context)
                    if (context[key] === this) {
                        context.action = key;
                        break;
                    }
            }
            
            if (typeof this.action === 'function')
                return this.action.apply(context || this, arguments);
        },
        
        url: function(params) {
            return this.bind(this, params);
        },
        
        toString: function() {
            return this.match;
        }
    });
    
    if (typeof $C === 'undefined')
        $C = Batman.Controller;
    
    if (typeof $route === 'undefined')
        $route = Batman.route;
    
    // Model
    
    Batman.Model = Batman.Mixin({
        isModel: true,
        
        all: Batman.binding([]),
        first: Batman.binding(function() {
            return this.all()[0];
        }),
        last: Batman.binding(function() {
            var all = this.all();
            return all[all.length - 1];
        }),
        
        beforeLoad: Batman.event(),
        load: Batman.event(function() {
            this.beforeLoad();
            this.prototype.readAllFromStore(function() {
                this.load.fire.apply(this.load, arguments);
            }.bind(this));
            
            return false;
        }),
        
        // record instantiation via model; adds to all array
        create: function() {
            var array = arguments[0];
            if (Array.isArray(array)) {
                var records = [];
                for (var i = -1, count = array.length; ++i < count;)
                    records.push(this.create(array[i]));
                
                return records;
            }
            
            var record = Batman.Mixin.prototype.create.apply(this, arguments);
            
            record.destroy(function() {
                this.all.removeObject(record);
            }.bind(this));
            
            this.all.push(record);
            return record;
        },
        
        find: function(selector) {
            var all = this.all();
            
            if (!selector)
                return;
            
            if (typeof selector === 'string' || typeof selector === 'number') {
                for (var i = -1, count = all.length; ++i < count;) {
                    if (all[i].id() == selector)
                        return all[i];
                }
                
                return this({id: selector});
            }
            
            for (var i = -1, count = all.length; ++i < count;) {
                var record = all[i];
                if (!record)
                    continue;
                
                for (var key in selector) {
                    if (!(key in record)) {
                        record = null;
                        break;
                    }
                    
                    var left = record[key];
                    var right = selector[key];
                    
                    if (left && left.isBinding) {
                        if (left() !== right) {
                            record = null;
                            break;
                        }
                    }
                    else if (left !== right) {
                        record = null;
                        break;
                    }
                }
                
                if (record)
                    return record;
            }
        }
    }).mixin({
        // creating a new model, returns custom record mixin
        create: function(identifier) {
            var model = Batman.Record.copy(typeof identifier === 'string' && identifier).mixin(Batman.Model);
            model.prototype.model = model;
            
            model.enhance.apply(model, arguments);
            
            setTimeout(function() {
                model.load();
            }, 0);
            
            return model;
        },
        
        Singleton: function() {
            return this.create.apply(this, arguments).create();
        }
    });
    
    Batman.Record = Batman.Mixin(Batman.Transactionable, {
        isRecord: true,
        model: null,
        
        id: $binding(null),
        
        autosaveInterval: 1000,
        saveLater: function(cancel) {
            if (this._isSaving)
                return;
            
            if (this._saveTimeout)
                this._saveTimeout = clearTimeout(this._saveTimeout);
            
            if (!cancel)
                this._saveTimeout = setTimeout(this.save.bind(this), this.autosaveInterval);
        },
        
        beforeSave: Batman.event(),
        save: Batman.event(function() {
            if (this._isSaving)
                return;
            
            if (this._saveTimeout)
                this._saveTimeout = clearTimeout(this._saveTimeout);
            
            this._isSaving = true;
            
            this.beforeSave();
            this.writeToStore(function() {
                this.save.fire.apply(this.save, arguments);
                delete this._isSaving;
            }.bind(this));
            
            return false;
        }),
        
        beforeLoad: Batman.event(),
        load: Batman.event(function() {
            if (this._isLoading)
                return;
            
            this._isLoading = true;
            
            this.beforeLoad();
            this.readFromStore(function() {
                this.load.fire.apply(this.load, arguments);
                delete this._isLoading;
            }.bind(this));
            
            return false;
        }),
        
        destroy: Batman.event(function() {
            this.removeFromStore(function() {
                this.destroy.fire.apply(this.destroy, arguments);
            }.bind(this));
            
            return false;
        }),
        
        serialize: function() {
            var obj = {};
            for (var key in this) {
                var binding = this[key];
                if (binding && binding.isBinding && !binding._preventAutocommit) {
                    var value = binding();
                    if (typeof value !== 'undefined')
                        obj[key] = value;
                }
            }
            
            return obj;
        },
        
        unserialize: function(data) {
            // FIXME camelCase
            Batman.mixin(this, data);
        },
        
        readAllFromStore: function(callback) { callback && callback(); },
        readFromStore: function(callback) { callback && callback(); },
        writeToStore: function(callback) { callback && callback(); },
        removeFromStore: function(callback) { callback && callback(); }
    }).mixin({
        enhance: function() {
            Batman.Mixin.prototype.enhance.apply(this, arguments);
            
            var proto = this.prototype, key;
            for (key in proto) {
                var binding = proto[key];
                if (binding && binding.isBinding && !binding._preventAutosave)
                    binding.observeDeferred(function() {
                        this.saveLater();
                    });
            }
            
            return this;
        }
    });
    
    Batman.Binding.enhance({
        preventAutosave: function() {
            this._preventAutosave = true;
            return this;
        },
        
        preventAutocommit: function() {
            this._preventAutocommit = true;
            return this;
        }
    });
    
    Batman.Model.mixin({
        hasMany: function(model) {
            
        },
        
        hasOne: function(model) {
            
        },
        
        belongsTo: function(model, key) {
            
        },
        
        timestamps: function() {
            return {
                createdAt: Batman.binding(null),
                updatedAt: Batman.binding(null)
            }
        }
    });
    
    if (typeof $M === 'undefined')
        $M = Batman.Model;
    
    // View
    
    Batman.View = Batman.Mixin({
        isView: true,
        
        initialize: function() {
            if (this.identifier)
                Batman.View.views[this.identifier] = this;
        },
        
        context: null,
        
        node: Batman.binding(null).observeForever(function(node) {
            if (!node)
                return;
            
            Batman.require(Batman.LIB_PATH + 'batman.dom.js', function() {
                Batman.DOM.view(this);
                this.ready();
            }.bind(this));
        }),
        
        template: Batman.binding(null).observeForever(function(template) {
            if (!template)
                return;
            
            Batman.Request({url: 'views/' + template + '.html'}).success(function(html) {
                this._template = html;
                
                var node = this.node() || document.createElement('div');
                node.innerHTML = html;
                
                this.node.value = null;
                this.node(node);
            }.bind(this));
        }),
        
        ready: Batman.event(null, true)
    }).mixin({
        views: {}
    });
    
    if (typeof $V === 'undefined')
        $V = Batman.View;
    
    // Helpers
    // FIXME: Should this go here? Should this even be part of Batman?
    
    var textHelper = function(formatter) {
        return function(bindingOrText, options) {
            if (bindingOrText && bindingOrText.isBinding) {
                var binding = Batman.binding(function() {
                    return formatter(bindingOrText(), options);
                });
                
                binding.observeDependencies();
                return binding;
            }
            
            return formatter(bindingOrText, options);
        }
    };
    
    Batman.View.helpers = {
        simple_format: textHelper(function(string, options) {
            return '<p>' + string
                .replace(/\r\n?/g, '\n')
                .replace(/\n\n+/g, '</p>\n\n<p>')
                .replace(/([^\n]\n)(?=[^\n])/g, '\1<br />') + // FIXME: Removes last letter
                '</p>';
        }),
        
        auto_link: textHelper(function(string, options) {
            return string; // FIXME
        })
    }
    
})();