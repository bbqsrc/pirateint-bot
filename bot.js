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

var seenPages = new Set();
var seenPosts = new Set();

function getRecentWikiChanges(callback) {
    var req = request("http://wiki.pirateint.org/w/api.php?hidebots=1&days=7&limit=10&translations=filter&action=feedrecentchanges&feedformat=atom"),
        fp = new feedparser();

    req.on('response', function(res) {
        this.pipe(fp);
    });

    fp.on('readable', function() {
        var item;

        while (item = this.read()) {
            if (seenPages.has(item.guid)) {
                continue;
            }

            var author = item.author,
                link = item.link,
                title = item.title,
                status = /oldid=0$/.test(link) ? "Page created" : "Page updated";

            seenPages.add(item.guid);

            if (callback != null) {
                callback("[wiki] " + status + ": '" + title + "' (" +
                         author + ") - " + link);
            }
        };
    });
}

function getRecentForumPosts(callback) {
    var req = request("https://discuss.pirateint.org/posts.json", function(err, res, body) {
        var posts = JSON.parse(body).latest_posts;

        posts.forEach(function(post) {
           if (seenPosts.has(post.id) || post.topic_slug == null) {
               return;
           }

           seenPosts.add(post.id);

           if (callback != null) {
               callback(post);
           }
        });
    });
}

client.addListener('connect', function() {
    let wikiCb = function(v) {
        channels.forEach(function(channel) {
            client.say(channel, v);
        });
    };

    let forumCb = function(post) {
        let v = "[forum] " +
                post.topic_slug + " - @" +
                post.username + ": ";

        let raw = post.raw;
        if (raw.length > 60) {
            raw = raw.slice(0, 57) + "...";
        }

        v += '"' + raw + '" - ';

        v += "https://discuss.pirateint.org/t/" +
             post.topic_slug + "/" +
             post.topic_id + "/" +
             post.post_number;

        channels.forEach(function(channel) {
            client.say(channel, v);
        });
    };

    // Initial run.
    console.log(new Date, "Initialising wiki change set.");
    getRecentWikiChanges();
    console.log(new Date, "Initialising forum change set.");
    getRecentForumPosts();

    setInterval(function() {
        console.log(new Date, "Getting recent changes...");
        getRecentWikiChanges(wikiCb);
        getRecentForumPosts(forumCb);
    }, 60000);
});

