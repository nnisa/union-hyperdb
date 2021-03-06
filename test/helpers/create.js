var hyperdb = require('@andrewosh/hyperdb')
var each = require('async-each')
var ram = require('random-access-memory')

var uniondb = require('../..')

function makeFactory () {
  var dbs = {}
  var idx = 0
  function factory (key, opts, cb) {
    if (typeof opts === 'function') return factory(key, null, opts)
    opts = opts || {}

    var baseDb = null
    var db = null

    if (key && dbs[key]) {
      baseDb = dbs[key]
    } else {
      baseDb = hyperdb(ram, key)
      baseDb.idx = idx++
    }

    db = baseDb
    if (opts.checkout) db = db.checkout(opts.checkout)

    db.ready(function (err) {
      if (err) return cb(err)
      dbs[baseDb.key] = baseDb
      db.idx = baseDb.idx
      return cb(null, db)
    })
  }
  return factory
}

function fromLayers (layerBatches, cb) {
  var dbs = []
  var currentDb = null
  var currentIdx = 0

  // Share hyperdbs between layers.
  var factory = makeFactory()

  makeNextLayer()

  function makeNextLayer (err) {
    if (err) return cb(err)
    if (currentIdx === layerBatches.length) return cb(null, currentDb, dbs)
    if (currentDb) {
      currentDb.version(function (err, version) {
        if (err) return cb(err)
        return makeUnionDB({
          parent: {
            key: currentDb.key,
            version: version
          },
          valueEncoding: 'utf8'
        })
      })
    } else {
      return makeUnionDB({
        valueEncoding: 'utf8'
      })
    }
  }

  function makeUnionDB (opts) {
    var batch = layerBatches[currentIdx++]
    var db = uniondb(factory, null, opts)
    each(batch, function (cmd, next) {
      switch (cmd.type) {
        case 'put':
          db.put(cmd.key, cmd.value, next)
          break
        case 'mount':
          if (cmd.versioned) {
            currentDb.version(function (err, version) {
              if (err) throw err
              db.mount(currentDb.key, cmd.key, {
                version: version,
                remotePath: cmd.remotePath
              }, next)
            })
          } else {
            db.mount(currentDb.key, cmd.key, {
              remotePath: cmd.remotePath
            }, next)
          }
          break
        case 'delete':
          db.delete(cmd.key, next)
          break
      }
    }, function (err) {
      if (err) throw err
      currentDb = db
      dbs.push(db)
      return makeNextLayer()
    })
  }
}

function twoFromLayers (layerFiles, cb) {
  fromLayers(layerFiles, function (err, db1) {
    if (err) return cb(err)
    db1.ready(function (err) {
      if (err) return cb(err)
      var db2 = uniondb(makeFactory(), db1.key, { valueEncoding: 'utf8' })
      db2.ready(function (err) {
        if (err) return cb(err)
        return cb(null, db1, db2)
      })
    })
  })
}

function two (cb) {
  var db1 = uniondb(makeFactory(), { valueEncoding: 'utf8' })
  db1.ready(function (err) {
    if (err) return cb(err)
    var db2 = uniondb(makeFactory(), db1.key, { valueEncoding: 'utf8' })
    db2.ready(function (err) {
      if (err) return cb(err)
      return cb(null, db1, db2)
    })
  })
}

module.exports = {
  fromLayers: fromLayers,
  twoFromLayers: twoFromLayers,
  two: two,
  makeFactory: makeFactory
}
