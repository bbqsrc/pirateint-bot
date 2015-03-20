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

function getRecentChanges(callback) {
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

client.addListener('connect', function() {
    let wikiCb = function(v) {
        channels.forEach(function(channel) {
            client.say(channel, v);
        });
    }

    // Initial run.
    console.log(new Date, "Initialising wiki change set.");
    getRecentChanges();

    setInterval(function() {
        console.log(new Date, "Getting recent changes...");
        getRecentChanges(wikiCb);
    }, 60000);
});

