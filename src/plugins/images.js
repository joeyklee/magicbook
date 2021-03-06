var fs = require("fs");
var path = require("path");
var _ = require("lodash");
var vfs = require("vinyl-fs");
var through = require("through2");
var streamHelpers = require("../helpers/stream");
var cheerio = require("cheerio");

var Plugin = function(registry) {
  registry.before("load", "images:move", _.bind(this.moveImages, this));
  registry.after(
    "markdown:convert",
    "images:replace",
    _.bind(this.replaceImages, this)
  );
};

// through2 pipe function that creates a hasmap of
// old -> image names.
function mapImages(imageMap, srcFolder, destFolder) {
  return through.obj(function(file, enc, cb) {
    // find the relative path to image. If any pipe has changed the filename,
    // it's the original is set in orgRelative, so we look at that first.
    var relativeFrom = file.orgRelative || file.relative;
    var relativeTo = path.join(destFolder, file.relative);
    imageMap[relativeFrom] = relativeTo;
    cb(null, file);
  });
}

// through2 pipe function that replaces images src attributes
// based on values in hashmap.
function replaceSrc(imageMap) {
  return through.obj(function(file, enc, cb) {
    file.$el = file.$el || cheerio.load(file.contents.toString());

    var changed = false;

    // loop over each image
    file.$el("img").each(function(i, el) {
      // convert el to cheerio el
      var jel = file.$el(this);
      var src = jel.attr("src");

      // if this image exists in source folder,
      // replace src with new source
      if (imageMap[src]) {
        // this file has changed
        changed = true;

        // find the relative path from the image to the file
        var srcRelative = path.relative(
          path.dirname(file.relative),
          imageMap[src]
        );

        jel.attr("src", srcRelative);
      } else if (!src.match(/^http/)) {
        console.log("image not found in source folder: " + src);
      }
    });

    // only if we find an image, replace contents in file
    if (changed) {
      file.contents = new Buffer(file.$el("body").html());
    }

    cb(null, file);
  });
}

Plugin.prototype = {
  moveImages: function(config, extras, callback) {
    this.imageMap = {};

    // load all files in the source folder
    var imagesStream = vfs.src(config.images.files);

    // digest
    if (_.get(config, "images.digest")) {
      imagesStream = imagesStream.pipe(streamHelpers.digest());
    }

    // save map of old and new file names
    imagesStream
      .pipe(
        mapImages(this.imageMap, config.images.files, config.images.destination)
      )

      // vinyl-fs dest automatically determines whether a file
      // should be updated or not, based on the mtime timestamp.
      // so we don't need to do that manually.
      .pipe(vfs.dest(path.join(extras.destination, config.images.destination)))
      .on("finish", function() {
        callback(null, config, extras);
      });
  },

  replaceImages: function(config, stream, extras, callback) {
    stream = stream.pipe(replaceSrc(this.imageMap));
    callback(null, config, stream, extras);
  }
};

module.exports = Plugin;
