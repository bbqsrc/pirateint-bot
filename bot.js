"use strict";

var request = require("request"),
    feedparser = require("feedparser"),
    config = require("./config.json"),
    irc = require("irc"),

    client;

console.log(config);

client = new irc.Client(config.network, config.name, {
    channels: config.channels
});

var getRecentWikiChanges = function getRecentWikiChangesPartial(baseURL) {
    return new Promise(function(resolve, reject) {
        var req = request(baseURL + "/w/api.php?hidebots=1&days=7&limit=10&translations=filter&action=feedrecentchanges&feedformat=atom"),
            fp = new feedparser();

        req.on('response', function(res) {
            this.pipe(fp);
        });

        fp.on('readable', function() {
            var items = [],
                item;

            while (item = this.read()) {
                items.push(item);
            }

            resolve(items);
        });
    });
}.bind(null, config.wikiURL);

var getForumCategories = function getForumCategoriesPartial(baseURL) {
    return new Promise(function(resolve, reject) {
        var req = request(baseURL + "/categories.json", function(err, res, body) {
            if (err) {
                return reject(err);
            }

            var categories = JSON.parse(body).category_list.categories,
                out = Object.create(null);

            categories.forEach(function(category) {
                out[category.id] = category.name;
            });

            resolve(out);
        });
    });
}.bind(null, config.discussURL);

var getLatestForumTopics = function getLatestForumTopicsPartial(baseURL) {
    return new Promise(function(resolve, reject) {
        var req = request(baseURL + "/latest.json", function(err, res, body) {
            if (err) {
                return reject(err);
            }

            var topics = JSON.parse(body).topic_list.topics,
                out = Object.create(null);

            topics.forEach(function(topic) {
                out[topic.id] = {
                    title: topic.title,
                    category_id: topic.category_id
                }
            });

            resolve(out);
        });
    });
}.bind(null, config.discussURL);

var getRecentForumPosts = function getRecentForumPostsPartial(baseURL) {
    return new Promise(function(resolve, reject) {
        var req = request(baseURL + "/posts.json", function(err, res, body) {
            if (err) {
                return reject(err);
            }

            return resolve(JSON.parse(body).latest_posts);
        });
    });
}.bind(null, config.discussURL);

function formatWikiPage(page) {
    var author = page.author,
        link = page.link,
        title = page.title,
        status = /oldid=0$/.test(link) ? "Page created" : "Page updated";

    return ("[wiki] " + status + ": '" + title + "' (" +
            author + ") - " + link);
}

function formatForumPostPartial(knownTopics, knownCategories, post) {
    let v = "";

    if (knownTopics[post.topic_id]) {
        let topic = knownTopics[post.topic_id];
        v += "[" + knownCategories[topic.category_id] + "] ";
        v += topic.title
    } else { v += "[???] ???" }

    v += ": <" + post.username + "> ";

    let raw = post.raw;
    if (raw.length > 70) {
        raw = raw.slice(0, 70) + "…";
    }

    v += '"' + raw.replace(/[\r\n]/g, " ") + '" - ';

    v += "https://discuss.pirateint.org/t/" +
         post.topic_slug + "/" +
         post.topic_id + "/" +
         post.post_number;

    return v;
}

function firstRun() {
    return Promise.all([
        getRecentWikiChanges(),
        getForumCategories(),
        getLatestForumTopics(),
        getRecentForumPosts()
    ]).then(function(vals) {
        let wikiChanges = vals[0];
        let forumCats = vals[1];
        let forumTopics = vals[2];
        let forumPosts = vals[3];

        console.log(new Date, "time for init");

        wikiChanges.forEach(function(change) {
            seenPages.add(change.guid);
        });

        forumPosts.forEach(function(post) {
            seenPosts.add(post.id);
        });

        seenCategories = forumCats;
        seenTopics = forumTopics;
    });
}

var seenPages = new Set();
var seenPosts = new Set();
var seenTopics;
var seenCategories;

client.addListener('connect', function() {
    firstRun().then(function() {
        console.log(new Date, "Init'd.");

        let formatForumPost = formatForumPostPartial.bind(null, seenTopics, seenCategories);

        setInterval(function() {
            console.log(new Date, "getting new data");

            Promise.all([getRecentWikiChanges(),
                         getLatestForumTopics(),
                         getRecentForumPosts()]).then(function(values) {
                let wiki = values[0];
                let topics = values[1];
                let posts = values[2];

                console.log(new Date, "updating.");

                Object.keys(topics).forEach(function(topic) {
                    seenTopics[topic] = topics[topic];
                });

                posts.forEach(function(post) {
                    if (seenPosts.has(post.id)) {
                        return;
                    }

                    let formatted = formatForumPost(post);
                    console.log(new Date, formatted);

                    config.channels.forEach(function(channel) {
                        client.say(channel, formatted);
                    });

                    seenPosts.add(post.id);
                });

                wiki.forEach(function(change) {
                    if (seenPages.has(change.guid)) {
                        return;
                    }

                    let formatted = formatWikiPage(change);
                    console.log(new Date, formatted);

                    config.channels.forEach(function(channel) {
                        client.say(channel, formatted);
                    });

                    seenPages.add(change.guid);
                });
            });
        }, 60000);
    }, function(err) { console.error(err); });
});

