/* jshint -W079 */
var gulp = require('gulp');
var args = require('yargs').argv;
var browserSync = require('browser-sync');
var config = require('./gulp.config')();
var del = require('del');
var $ = require('gulp-load-plugins')({lazy: true});
var port = process.env.PORT || config.defaultPort;
var watch = require('gulp-watch');

/**
 * Default task
 */
gulp.task('help', $.taskListing);
gulp.task('default', ['help']);

/**
 * Analyzing source with JSHint and JSCS
 */
gulp.task('vet', function() {
    log('Analyzing source with JSHint and JSCS');
    return gulp.src(config.alljs)
        .pipe($.if(args.verbose, $.print()))
        .pipe($.jscs())
        .pipe($.jshint())
        .pipe($.jshint.reporter('jshint-stylish', {verbose: true}))
        .pipe($.jshint.reporter('fail'));
});

/**
 * Cleaning tasks
 */
gulp.task('clean', function(done) {
    var delconfig = [].concat(config.build, config.temp);
    log('Cleaning: ' + $.util.colors.blue(delconfig));
    del(delconfig, done);
});

gulp.task('clean-styles', function(done) {
    clean(config.temp + '**/*.css', done);
});

gulp.task('clean-images', function(done) {
    clean(config.build + 'images/**/*.*', done);
});

gulp.task('clean-fonts', function(done) {
    clean([config.temp + 'font/**/*.*', config.build + 'font/**/*.*'], done);
});

gulp.task('clean-code', function(done) {
    var files = [].concat(
        config.temp + '**/*.js',
        config.build + '**/*.html',
        config.build + 'js/**/*.js'
    );
    clean(files, done);
});

/**
 * Compiling LESS to CSS task
 */
gulp.task('styles', ['clean-styles'], function() {
    log('Compiling Less to CSS');

    return gulp.src(config.less)
        .pipe($.plumber())
        .pipe($.less())
        .pipe($.autoprefixer({browser: ['last 2 version', '> 5%']}))
        .pipe(gulp.dest(config.temp + 'styles/'));
});

gulp.task('images', ['clean-images'], function() {
    log('Copying and compressing the images');

    return gulp
        .src(config.images)
        .pipe($.imagemin({optimizationLevel: 4}))
        .pipe(gulp.dest(config.build + 'images'));
});

gulp.task('fonts', ['clean-fonts'], function() {
    return gulp
        .src(config.fonts)
        //.pipe(gulp.dest(config.temp + 'fonts'))
        .pipe(gulp.dest(config.build + 'font'));
});

/**
 * Watching LESS files task
 */
gulp.task('less-watcher', function() {
    gulp.watch([config.less], ['styles']);
});

/**
 * Template Caching task
 */
gulp.task('templatecache', ['clean-code'], function() {
    log('Creating AngularJS $templateCache');

    return gulp
        .src(config.htmlTemplates)
        .pipe($.minifyHtml({empty: true}))
        .pipe($.angularTemplatecache(
            config.templateCache.file,
            config.templateCache.options
        ))
        .pipe(gulp.dest(config.temp));
});

/**
 * Inject dependencies into HTML  task (from bower.json devDependencies and app CSS)
 */
gulp.task('wiredep', function() {
    log('Wire up the bower css jss and our app js into the HTML');
    var options = config.getWiredepDefaultOptions();
    var wiredep = require('wiredep').stream;

    return gulp
        .src(config.index)
        .pipe(wiredep(options))
        .pipe($.inject(gulp.src(config.js)))
        .pipe(gulp.dest(config.client));
});

gulp.task('inject', ['wiredep', 'styles', 'fonts', 'templatecache'], function() {
    log('Wire up the app css and call wireup');

    return gulp
        .src(config.index)
        .pipe($.inject(gulp.src(config.css)))
        .pipe(gulp.dest(config.client));
});

/**
 * Optimize task
 */
gulp.task('optimize', ['inject', 'test'], function() {
    log('Optimizing the javascript, css, html');

    var assets = $.useref.assets({searchPath: './'});
    var templateCache = config.temp + config.templateCache.file;
    var cssFilter = $.filter('**/*.css');
    var jsLibFilter = $.filter('**/' + config.optimized.lib);
    var jsAppFilter = $.filter('**/' + config.optimized.app);

    return gulp
        .src(config.index)
        .pipe($.plumber())
        .pipe($.inject(gulp.src(templateCache, {read: false}), {
            starttag: '<!-- inject:templates:js -->'
        }))
        .pipe(assets)
        .pipe(cssFilter)
        .pipe($.csso())
        .pipe(cssFilter.restore())
        .pipe(jsLibFilter)
        .pipe($.uglify())
        .pipe(jsLibFilter.restore())
        .pipe(jsAppFilter)
        .pipe($.ngAnnotate())
        .pipe($.uglify())
        .pipe(jsAppFilter.restore())
        .pipe($.rev())
        .pipe(assets.restore())
        .pipe($.useref())
        .pipe($.revReplace())
        .pipe(gulp.dest(config.build))
        .pipe($.rev.manifest())
        .pipe(gulp.dest(config.build));
});

/**
 * Run all tasks for build web app
 * - Copying static files (images, fonts, etc)
 * - Run optimize task
 */
gulp.task('build', ['optimize', 'images'], function() {
    log('Build everything');

    var msg = {
        title: 'gulp build',
        subtitle: 'Deployed to the build folder',
        message: 'Running `gulp serve-build` '
    };
    del(config.temp);
    log(msg);
});

gulp.task('bump', function() {
    var msg = 'Bumping versions';
    var type = args.type;
    var version = args.version;
    var options = {};
    if (version) {
        options.version = version;
        msg += ' to ' + version;
    } else {
        options.type = type;
        msg += ' for a ' + type;
    }
    log(msg);
    return gulp
        .src(config.packages)
        .pipe($.bump(options))
        .pipe(gulp.desg(config.root));
});

/**
 * Serve web apps for Development
 */
gulp.task('serve-dev', ['inject'], function() {
    serve(true);
});

gulp.task('serve-build', ['build'], function() {
    serve(false);
});

/**
 * Testing tasks
 */
gulp.task('test', ['vet', 'templatecache'], function(done) {
    startTests(true, done);
});

//////////////////

function serve(isDev, specRunner) {
    var nodeOptions = {
        script: config.nodeServer,
        delayTime: 1,
        env: {
            'PORT': port,
            'NODE_ENV': isDev ? 'dev' : 'build'
        },
        watch: [config.server]
    };

    return $.nodemon(nodeOptions)
        .on('restart', function(ev) {
            log('*** nodemon restarted');
            log('files changed on restart:\n' + ev);
            setTimeout(function() {
                browserSync.notify('reloading now...');
                browserSync.reload({stream: false});
            }, config.browserReloadDelay);
        })
        .on('start', function() {
            log('*** nodemon started');
            startBrowserSync(isDev, specRunner);
        })
        .on('crash', function() {
            log('*** nodemon crashed: script crashed for some reason');
        })
        .on('exit', function() {
            log('*** nodemon exited cleanly');
        });
}

function startBrowserSync(isDev, specRunner) {
    if (args.nosync || browserSync.active) {
        return;
    }

    log('Starting browser-sync on port ' + port);

    if (isDev) {
        gulp.watch([config.less], ['styles']);
        watch(config.js, function() {
            gulp.start('wiredep');
        });
    } else {
        gulp.watch([config.less, config.js, config.html], ['optimize', browserSync.reload]);
    }

    var options = {
        proxy: 'localhost:' + port,
        port: 3000,
        files: isDev ? [
            config.client + '**/*.*',
            '!' + config.less,
            config.temp + '**/*.css'
        ] : [],
        ghostMode: {
            clicks: true,
            location: false,
            forms: true,
            scroll: true
        },
        logLevel: 'debug',
        logPrefix: 'gulp-patterns',
        notify: true,
        reloadDelay: 1000
    };

    if (specRunner) {
        options.startPath = config.specRunnerFile;
    }

    browserSync(options);
}

function startTests(singleRun, done) {
    var child;
    var fork = require('child_process').fork;
    var karma = require('karma').server;
    var excludeFiles = [];
    //var serverSpecs = config.serverIntegrationSpecs;

    if (args.startServers) { // gulp test --startServers
        log('Starting server');
        var savedEnv = process.env;
        savedEnv.NODE_ENV = 'dev';
        savedEnv.PORT = 8888;
        child = fork(config.nodeServer);
    }
    //else {
    //    if (serverSpecs && serverSpecs.length) {
    //        excludeFiles = serverSpecs;
    //    }
    //}

    karma.start({
        configFile: __dirname + '/karma.conf.js',
        exclude: excludeFiles,
        singleRun: !!singleRun
    }, karmaCompleted);

    function karmaCompleted(karmaResult) {
        log('Karma completed!');
        if (child) {
            log('Shutting down the child process');
            child.kill();
        }
        if (karmaResult === 1) {
            done('karma: tests failed with code ' + karmaResult);
        } else {
            done();
        }
    }
}

function clean(path, done) {
    log('Cleaning: ' + $.util.colors.blue(path));
    del(path, done);
}

function log(msg) {
    if (typeof msg === 'object') {
        for (var item in msg) {
            if (msg.hasOwnProperty(item)) {
                $.util.log($.util.colors.blue(msg[item]));
            }
        }
    } else {
        $.util.log($.util.colors.blue(msg));
    }
}
