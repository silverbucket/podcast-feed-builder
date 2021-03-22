const base_url = 'https://example-podcast-site.com';
module.exports = {
    feedfile: "feed.xml",
    urls: {
        base: base_url,
        episodes: `/category/episodes`
    },
    headers: {
        cookie: 'put your cookie string here'
        userAgent: 'put your browsers useragent string here'
    },
    dropbox: {
        token: 'generate token in your dropbox app',
        accountId: 'dbid:...',
        episodes: '/episodes',
        metadata: '/metadata'
    },
    podcast: {
        title: 'Example Podcast Site',
        feedUrl: 'public feed url where you will host the feed file',
        siteUrl: 'podcast site',
        imageUrl: 'link to image for feedreader to use',
        author: 'author of podcast'
    }
};
