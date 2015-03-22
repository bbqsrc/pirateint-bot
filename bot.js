"use strict";

var request = require("request"),
    feedparser = require("feedparser"),
    irc = require("irc"),

    client,
    channels;

channels = ["#pirateint"];

client = new irc.Client('irc.pirateirc.net', 'pirateint', {
    channels: channels
});

function getRecentWikiChanges() {
    return new Promise(function(resolve, reject) {
        var req = request("http://wiki.pirateint.org/w/api.php?hidebots=1&days=7&limit=10&translations=filter&action=feedrecentchanges&feedformat=atom"),
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
}

function getForumCategories() {
    return new Promise(function(resolve, reject) {
        var req = request("https://discuss.pirateint.org/categories.json", function(err, res, body) {
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
}

function getLatestForumTopics(callback) {
    return new Promise(function(resolve, reject) {
        var req = request("https://discuss.pirateint.org/latest.json", function(err, res, body) {
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
}

function getRecentForumPosts() {
    return new Promise(function(resolve, reject) {
        var req = request("https://discuss.pirateint.org/posts.json", function(err, res, body) {
            if (err) {
                return reject(err);
            }

            return resolve(JSON.parse(body).latest_posts);
        });
    });
}

var seenPages = new Set();
var seenPosts = new Set();
var seenTopics;
var seenCategories;

function formatWikiPage(page) {
    var author = page.author,
        link = page.link,
        title = page.title,
        status = /oldid=0$/.test(link) ? "Page created" : "Page updated";

    return ("[wiki] " + status + ": '" + title + "' (" +
            author + ") - " + link);
}

function formatForumPost(knownTopics, knownCategories, post) {
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

client.addListener('connect', function() {
    firstRun().then(function() {
        console.log(new Date, "Init'd.");

        let fmtForumPostLocal = formatForumPost.bind(null,
                                                     seenTopics,
                                                     seenCategories);

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

                    let formatted = fmtForumPostLocal(post);
                    console.log(new Date, formatted);

                    channels.forEach(function(channel) {
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

                    channels.forEach(function(channel) {
                        client.say(channel, formatted);
                    });

                    seenPages.add(change.guid);
                });
            });
        }, 60000);
    }, function(err) { console.error(err); });
});

