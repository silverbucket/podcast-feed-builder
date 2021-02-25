const path = require('path');
const fs = require('fs');
const axios = require('axios');
const parse = require('node-html-parser').parse;
const RSS = require('rss');

const config = require('./config.js');
// const episodes = {};
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
    console.log("failed download file");
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
          url: header.href,
          date: "",
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
              page.description = document.querySelector('section').innerText;
              const source = document.querySelector('source');
              if (source) {
                page.srcAudio = source.attributes.src.split('?')[0];
              }
            }).then(() => {
              // download audio file
              if (page.srcAudio) {
                return downloadFile(page.srcAudio, config.docroot);
              }
            }).then(() => {
              // set public download url
              if (page.srcAudio) {
                page.src = `${config.podcast.site_url}/${page.srcAudio.split('/').pop()}`;
              }
            }).then(() => {
              if (page.srcAudio) {
                // episodes[page.guid] = page;
                feed.item(page);
                console.log(`finished ${page.title}`);
              } else {
                console.log(`skipping ${page.title}`);
              }
            }).then(() => {
              completed += 1;
              if (completed === pages.length) resolve();
            }).catch((err) => {
              console.log(`failed getting episode data for ${page.url}`, err.toString());
            });
        });
      });
    }).then(() => {
      console.log(`completed page {$page}`, );
      return fetchPage(++page);
    }).catch((err) => {
      console.log(err.toString());
      // generate rss feed
      fs.writeFile(config.feedfile, feed.xml({index: true}),
        () => { console.log(`successfully wrote feed to ${config.feedfile}`)});
    });
}
fetchPage(1);