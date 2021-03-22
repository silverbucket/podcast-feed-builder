const fs = require('fs');
const stream = require('stream');
const axios = require('axios');
const parse = require('node-html-parser').parse;
const Podcast = require('podcast');
const dropboxV2Api = require('dropbox-v2-api');
const asyncPool = require('tiny-async-pool');

const config = require('./config.js');
const feed = new Podcast(config.podcast);
let dropboxFiles = [];

// dropbox api
const dropbox = dropboxV2Api.authenticate({
  token: config.dropbox.token
});

// http requests
const session = axios.create({
  baseURL: config.urls.base,
  headers: config.headers
});


function processIndex(res) {
  return new Promise((resolve, reject) => {
    // get list of episodes from index page
    const document = parse(res.data);
    const articles = document.querySelectorAll('article');
    const index = [];
    for (let elem of articles) {
      const header = elem.childNodes[1].childNodes[1].childNodes[0].attributes;
      index.push({
        guid: elem.id,
        title: header.title,
        desc: "",
        url: header.href.trim(),
        date: "",
        filename: "",
        description: "",
        srcAudio: "",
        enclosure: {
          type: "audio/mpeg",
          url: ""
        },
      });
    }
    return resolve(index);
  });
}

function processPage(res) {
  const document = parse(res.data);
  const section = document.querySelector('section');
  const source = document.querySelector('source');
  const time = document.querySelector('time');
  let audio = "";
  if (source) {
    audio = source.attributes.src;
  } else {
    try {
      for (let elem of section.childNodes) {
        if (typeof elem.getAttribute === 'function' && elem.getAttribute('class') === 'episode-audio-box') {
          try {
            audio = elem.querySelector('a').attributes.href;
          } catch (e) {
          }
        }
      }
    } catch (e) {
      return {}
    }
  }
  const entry = {
    srcAudio: audio.split('?')[0]
  };
  if (! entry.srcAudio) {
    return entry;
  }
  entry.filename = entry.srcAudio.split('/').pop();
  entry.description = section.innerText;
  entry.date = time.attributes.datetime;
  return entry;
}

function existsOnDropbox(entry) {
  if (! entry.filename) { return entry; }
  let matched = dropboxFiles.find((x) => {
    return (x.name === entry.filename);
  });
  if (matched) {
    entry.dropboxId = matched.id
  }
  return entry;
}

function saveToDropbox(entry) {
  return new Promise((resolve, reject) => {
    if (! entry.srcAudio) { return resolve(entry); }
    if (entry.dropboxId) { return resolve(entry); }
    dropbox({
      resource: 'files/save_url',
      parameters: {
        path: `${config.dropbox.folder}/${entry.filename}`,
        url: entry.srcAudio
      }
    }, (err, result, response) => {
      // upload complete
      if (err) { return reject('saving to dropbox ' + err); }
      process.stdout.write('... saved to dropbox ')
      return resolve(entry);
    });
  })
}

function getSharedLink(entry) {
  return new Promise((resolve, reject) => {
    if (entry.enclosure) { return resolve(entry); }
    if (! entry.dropboxId) { return resolve(entry); }
    dropbox({
      resource: 'sharing/list_shared_links',
      parameters: {
        path: entry.dropboxId
      }
    }, (err, result, response) => {
      if (err) {
        return reject('getting shared link ' + err);
      }
      if (result.links.length > 0) {
        process.stdout.write('... got link ')
        entry.enclosure = {
          url: result.links[0].url
        }
      }
      return resolve(entry);
    });
  })
}

function createSharedLink(entry) {
  return new Promise((resolve, reject) => {
    if (! entry.srcAudio) { return resolve(entry); }
    if (! entry.dropboxId) { return resolve(entry); }
    if (entry.enclosure) { return resolve(entry); }
    dropbox({
      resource: 'sharing/create_shared_link_with_settings',
      parameters: {
        path: `${config.dropbox.folder}/${entry.filename}`,
        settings :{
          requested_visibility: "public",
          audience: "public",
          access: "viewer"
        }
      }
    }, (err, result, response) => {
      if (err) {
        if (err.code !== 409) {
          return reject('create shared link ' + err);
        }
      } else {
        process.stdout.write('... created link ');
        entry.enclosure = {
          url: result.url
        }
      }
      return resolve(entry);
    });
  })
}

function getMetadata(entry) {
  return new Promise((resolve, reject) => {
    if (! entry.title) { return resolve(entry); }
    const episode = new stream.Writable();
    episode._write = function (chunk, encoding, done) {
      const metadata = JSON.parse(chunk.toString());
      if (metadata.error) {
        return resolve(entry);
      } else {
        process.stdout.write('... got metadata ');
        return resolve(metadata);
      }
    }
    dropbox({
      resource: 'files/download',
      parameters: {
        path: config.dropbox.folder + '/' + entry.title + '.json'
      }
    }, (err, result) => {
      // download completed
      if (err) { reject('write episode data to dropbox ' + err); }
    }).pipe(episode)
  })
}

function saveMetadata(entry) {
  return new Promise((resolve, reject) => {
    if (! entry) { return resolve(entry); }
    if (entry.saved) { return resolve(entry); }
    entry.saved = true;
    const episode = new stream.Readable();
    episode.push(JSON.stringify(entry));
    episode.push(null);
    dropbox({
      resource: 'files/upload',
      parameters: {
        mode: "overwrite",
        path: config.dropbox.folder + '/' + entry.title + '.json'
      },
      readStream: episode
    }, (err, result) => {
      // upload completed
      if (err) { reject('write episode data to dropbox ' + err); }
      else {
        process.stdout.write('... saved metadata ');
        return resolve(entry);
      }
    });
  })
}

// get audio file and description from each page
// save to dropbox
// save metadata to dropbox
const scrapePage = entry => new Promise((resolve, reject) => {
  console.log(`\n+ page ${entry.url}`);
  return getMetadata(entry).then((e) => {
      if (e.enclosure.url) { return e; }
      process.stdout.write('... fetching ');
      return session.get(`${e.url}`)
        .then(processPage).catch((err) => { throw new Error('failed to fetch url ' + e.url + ': ' + err.toString())});
    })
    .then(existsOnDropbox)
    .then(saveToDropbox)
    .then(getSharedLink)
    .then(createSharedLink)
    .then((e) => {
      return Object.assign(entry, e);
    })
    .then(saveMetadata)
    .then((e) => {
      if (! e.enclosure.url) {
        console.log(`\n* skipping ${e.url}`)
      } else {
        feed.addItem(e);
        console.log('... added to feed');
      }
      return resolve();
    })
    .catch((err) => {
      console.log(`Error`);
      console.log(err);
    });
});

function fetchPages(index) {
  console.log(`fetched index of ${index.length} entries... `)
  return asyncPool(1, index, scrapePage);
}

function fetchIndex(page) {
  const pageUrl = `${config.urls.episodes}/page/${page}/`;
  console.log(`\nfetching ${pageUrl}`);
  session.get(pageUrl)
    .then(processIndex)
    .then(fetchPages)
    // .then(() => { return fetchIndex(++page); })
    .catch((err) => {
      console.log(err);
      console.log(`\nfinished indexing website, writing feed... `);
      fs.writeFile(config.feedfile, feed.buildXml('\t'), () => {
        console.log(`= successfully wrote feed to ${config.feedfile}`)
      });
    });
}

dropbox({
  resource: 'files/list_folder',
  parameters: {
    path: config.dropbox.folder
  }
}, (err, result) => {
  dropboxFiles = result.entries;
  if (process.argv.length === 3) {
    return scrapePage({ url: process.argv[2] });
  } else {
    return fetchIndex(1);
  }
});
