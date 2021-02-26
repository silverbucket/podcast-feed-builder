const path = require('path');
const fs = require('fs');
const axios = require('axios');
const parse = require('node-html-parser').parse;
const RSS = require('rss');

const config = require('./config.js');
const feed = new RSS(config.podcast);

const session = axios.create({
  baseURL: config.urls.base,
  headers: config.headers
});

const downloadFile = async (fileUrl, downloadFolder) => {
  // Get the file name
  const fileName = path.basename(fileUrl);
  // The path of the downloaded file on our machine
  const localFilePath = path.resolve(__dirname, downloadFolder, fileName);
  try {
    const response = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "stream",
    });
    await response.data.pipe(fs.createWriteStream(localFilePath));
  } catch (err) {
    console.log("... file download failed ", err.toString());
    throw new Error(err);
  }
};

function fetchPage(page) {
  session.get(`${config.urls.episodes}/page/${page}/`)
    .then((res) => {
      // get list of episodes from index page
      const document = parse(res.data);
      const articles = document.querySelectorAll('article');
      const pages = [];
      for (let elem of articles) {
        const header = elem.childNodes[1].childNodes[1].childNodes[0].attributes;
        pages.push({
          guid: elem.id,
          title: header.title,
          url: header.href.trim(),
          date: "",
          filename: "",
          description: "",
          audio: "",
          srcAudio: "",
        });
      }
      return pages;
    }).then((pages) => {
      // get audio file and description from each page
      return new Promise((resolve, reject) => {
        let completed = 0;
        return pages.forEach((page) => {
          session.get(`${page.url}`)
            .then((res) => {
              const document = parse(res.data);
              const section = document.querySelector('section');
              // page.description = section.innerText;
              const source = document.querySelector('source');
              let audio = "";
              if (source) {
                audio = source.attributes.src;
              } else {
                for (let elem of section.childNodes) {
                  if (typeof elem.getAttribute === 'function' && elem.getAttribute('class') === 'episode-audio-box') {
                    try {
                      audio = elem.querySelector('a').attributes.href;
                    } catch (e) {}
                  }
                }
              }
              page.srcAudio = audio.split('?')[0];
            }).then(() => {
              // download audio file
              if (page.srcAudio) {
                page.filename = page.srcAudio.split('/').pop();
                if (fs.existsSync(`${config.docroot}${page.filename}`)) {
                  console.log(`... skipping ${page.title} - already downloaded`);
                } else {
                  return downloadFile(page.srcAudio, config.docroot);
                }
              }
            }).then(() => {
              // set public download url
              if (page.srcAudio) {
                page.src = `${config.podcast.site_url}/${page.filename}`;
              }
            }).then(() => {
              if (page.srcAudio) {
                // episodes[page.guid] = page;
                feed.item(page);
                console.log(`+ finished ${page.title}`);
              } else {
                console.log(`... no audio found for ${page.title} - ${page.url}`);
              }
            }).then(() => {
              completed += 1;
              if (completed === pages.length) resolve();
            }).catch((err) => {
              console.log(`... failed getting episode data for ${page.url}`, err.toString());
            });
        });
      });
    }).then(() => {
      console.log(`completed page ${page}`);
      return fetchPage(++page);
    }).catch((err) => {
      console.log(err.toString());
      // generate rss feed
      fs.writeFile(config.feedfile, feed.xml({index: true}),
        () => { console.log(`= successfully wrote feed to ${config.feedfile}`)});
    });
}
fetchPage(1);
