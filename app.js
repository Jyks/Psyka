var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var url = require('url');
var fs = require('fs');

var public_dir = __dirname + "/public";
var port = 8080;

var games = require('./games.json');
// {name: "", players: [], marker: {name: ""}, activity: 0, room: "livingroom", happening: []}

var pins = require('./pins.json');

// Clear up games database
(function() {
	for(var i = 0; i < games.length; i++) {
		games[i].players = [];
		games[i].happening = [];
	}
})();

var sockets = [];
var idleActivityAllowed = [];

// Confirmation stuff
var possibleRooms = ["livingroom", "kitchen", "bathroom", "bedroom", "yard", "mall"];

// Marker width & height, used for room bounds
var mw = 40 / 2, mh = 160 / 2;

// Room bounds
var roomBounds = {
	livingroom: {
		x1: 219 + mw,
		y1: 442 - mh,
		x2: 626 - mw,
		y2: 597 - mh * 2
	},
	kitchen: {
		x1: 279 + mw,
		y1: 393 - mh,
		x2: 440 - mw,
		y2: 597 - mh * 2
	},
	bathroom: {
		x1: 355 + mw,
		y1: 471 - mh,
		x2: 687 - mw,
		y2: 597 - mh * 2
	},
	bedroom: {
		x1: 62 + mw,
		y1: 521 - mh,
		x2: 800 - mw,
		y2: 600 - mh * 2
	},
	yard: {
		x1: 0 + mw,
		y1: 359 - mh,
		x2: 554 - mw,
		y2: 600 - mh * 2
	},
	mall: {
		x1: 224 + mw,
		y1: 396 - mh,
		x2: 550 - mw,
		y2: 600 - mh * 2
	}
}

// Handling of static files
var staticFiles = [
	{get: "/", give: "/index.html"},
	{get: "/game/images/livingroom.png", give: "/images/livingroom.png"},
	{get: "/game/images/kitchen.png", give: "/images/kitchen.png"},
	{get: "/game/images/bathroom.png", give: "/images/bathroom.png"},
	{get: "/game/images/bedroom.png", give: "/images/bedroom.png"},
	{get: "/game/images/yard.png", give: "/images/yard.png"},
	{get: "/game/images/mall.png", give: "/images/mall.png"},
	{get: "/game/images/babe.kyn.png", give: "/images/babe.kyn.png"},
	{get: "/game/credits", give: "/game/credits.html"},
];

// TV programme urls
var programmes = [
	"http://media.assembly.org/vod/2013/Compos/1683_Demo_Return_by_Pyrotech.mp4",
	"http://media.assembly.org/vod/2013/Compos/1616_Oldskool_Norwegian_Pillow_by_Dekadence.mp4",
	"http://media.assembly.org/vod/2013/Compos/1657_Realwild_MCMC_by_elite_ninjas.mp4",
	"http://media.assembly.org/vod/2015/Compos/2057_Demo_DEMO2_by_Ekspert.mp4",
	"http://media.assembly.org/vod/2015/Compos/2049_Demo_HoldAndModify_by_CNCD__Fairlight.mp4",
	"http://media.assembly.org/vod/2015/Compos/2045_Demo_Monolith_by_Andromeda_Software_Development.mp4"
];

function arrayContains(array, token) {
	for(var i = 0; i < array.length; i++)
		if(array[i] === token)
			return true;

	return false;
}

function randomInt(max) {
	return Math.floor((Math.random() * max));
}

function randomBoolean() {
	return randomInt(2) === 1;
}

function randomId() {
	var toreturn = "u";
	for(var i = 0; i < 12; i++) toreturn += randomInt(9);
	return toreturn;
}

function getGame(gamename) {
	for(var i = 0; i < games.length; i++) {
		if(games[i].name === gamename) {
			return i;
		}
	}
	
	var newid = games.length;
	games[newid] = {
		name: gamename,
		players: [],
		marker: {
			name: "",
			sex: randomBoolean()? "male" : "female",
			age: 0
		},
		activity: 0,
		room: "livingroom",
		happening: [],
		attrs: {
			happiness: 3,
			attachement: 3
		},
		upgrade: 3
	};
	
	var names = getNames(newid);
	setTimeout(function() {
		games[newid].happening = {
			client: {
				title: ["Naming time!"],
				options: [
					names[0],
					names[1],
					names[2]
				]
			},

			server: [
				function() {
					games[newid].marker.name = names[0];
					sendToGame(newid, "marker", games[newid].marker);
				},
				function() {
					games[newid].marker.name = names[1];
					sendToGame(newid, "marker", games[newid].marker);
				},
				function() {
					games[newid].marker.name = names[2];
					sendToGame(newid, "marker", games[newid].marker);
				}
			]
		};

		sendToGame(newid, "happening", games[newid].happening.client);
	}, 10000);

	return newid;
}

function sendToGame(gameid, message, data) {
	for(var i = 0; i < sockets.length; i += 3) {
		if(sockets[i+1] === gameid) {
			sockets[i].emit(message, data);
		}
	}
}

function addActivity(gameid, count) {
	games[gameid].activity += count;
	sendToGame(gameid, "activity", Math.floor(games[gameid].activity));
}

function getQueuePos(gameid, userid) {
	var pos = 1;

	for(var i = 0; i < games[gameid].players.length; i++) {
		if(userid === games[gameid].players[i]) return pos;
		else if(games[gameid].players[i] !== undefined && games[gameid].players[i] !== null) pos++;
	}
}

function getPriority(gameid, userid) {
	var priority = 1;

	for(var i = 0; i < games[gameid].players.length; i++) {
		if(userid === games[gameid].players[i]) return priority;
		else if(games[gameid].players[i] !== undefined && games[gameid].players[i] !== null) priority /= 2;
	}
}

function removePlayerFromGame(gameid, playerid) {
	for(var i = 0; i < games[gameid].players.length; i++) {
		if(games[gameid].players[i] === playerid) {
			games[gameid].players[i] = undefined;
			return;
		}
	}
}

function checkPin(gamename, pin) {
	for(var i = 0; i < pins.length; i += 2) {
		if(pins[i] === gamename
		&& (pins[i+1] === pin || (""+pins[i+1]).replace(new RegExp(" ", "g"), "") === "" || pins[i+1] === undefined || pins[i+1] === null)) {
			return true;
		} else if(pins[i] === gamename) {
			return false;
		}
	}
	
	// Create new entry
	pins[pins.length] = gamename;
	pins[pins.length] = pin;
	console.log("Setting pin " + pin + " for gamename " + gamename);
		
	return true;
}

function getRandomHappening(gameid) {
	var age = games[gameid].marker.age;

	if(age === 0) {
		return {
			client: {
				title: [
					games[gameid].marker.name + ": bblaeaebloeaehfklmaeae"
				],
				options: [
					"(ignore)",
					"Yes, very much",
					"SHUT. THE FUCK. UP!"
				]
			},
			server : [
				function() {
					games[gameid].attrs.attachement -= 0.5;
				},
				function() {
					games[gameid].marker.age = 1;
					games[gameid].upgrade = 0;
				},
				function() {
					games[gameid].attrs.happiness--;
					games[gameid].attrs.attachement--;
				}
			]
		};
	} else if(age === 2) {
		if(randomBoolean()) return {
			client: {
				title: [games[gameid].marker.name + ": MUMMY! I WANT CANDY!"],
				options: [
					"Ok, broccoli's shit anyway",
					"No, eat the broccoli!"
				]
			},
			server: [
				function() {
					if(games[gameid].attrs.happiness <= 5)
						games[gameid].attrs.happiness++;
				},
				function() {
					games[gameid].happiness -= 0.5;
					games[gameid].upgrade -= 1.5;
				}
			]
		};
		else return {
			client: {
				title: [games[gameid].marker.name + ": MUMMY I WANT THIS NEW TOY!!!!!!!111"],
				options: ["Ok, ok...", "No!"]
			},
			server: [
				function() {
					games[gameid].attachement -= 0.5;
				},
				function() {
					// TODO gets really mad!
					games[gameid].upgrade = 0;
				}
			]
		};
	} else if(age === 3) {
		return {
			client: {
				title: [games[gameid].marker.name + ": Muummyyy! Come wipe my butt!"],
				options: [
					"Coming!",
					"You're a big one, you can do it!",
					"You can wipe your own shit!"
				]
			},
			server: [
				function() {
					if(games[gameid].attrs.happiness <= 5)
						games[gameid].attrs.happiness++;
				},
				function() {
					games[gameid].upgrade = 0;
				},
				function() {
					games[gameid].upgrade--;
					games[gameid].attrs.attachement--;
					games[gameid].attrs.happiness--;
				}
			]
		}
	} else if(age === 4) {
		return {
			client: {
				title: [games[gameid].marker.name + ": Mommy, I had a bad dream! There's a monster in my closet!"],
				options: [
					"It's okay, it's not real",
					"Ok, I'll check",
					"I'M TRYING TO SLEEP!"
				]
			},
			server: [
				function() {
					games[gameid].attrs.happiness--;
					games[gameid].upgrade -= 2;
				},
				function() {
					games[gameid].attrs.happiness++;
					games[gameid].upgrade--;
				},
				function() {
					games[gameid].attrs.happiness--;
					games[gameid].attrs.attachement--;
				}
			]
		}
	} else if(age === 5) {
		return {
			client: {
				title: [
					games[gameid].marker.name + ": Mommy, where do babies come from?"
				],
				options: [
					"When mum&dad love each other...",
					"Sex. Google it.",
					"The stork brings them"
				]

			},
			server: [
				function() {
					games[gameid].upgrade = 0;
				},
				function() {
					games[gameid].attrs.happiness -= 2;
				},
				function() {
					games[gameid].attrs.attachement--;
				}
			]
		}
	} else if(age === 6) {
		return {
			client: {
				title: [
					games[gameid].marker.name + ": I'm a bit nervous about school..."
				],
				options: [
					"You'll be fine",
					"You'd sure man up, yo!"
				]
			},
			server: [
				function() {
					games[gameid].upgrade = 0;
					games[gameid].attrs.happiness++;
				},
				function()  {
					games[gameid].attrs.attachement--;
				}
			]
		}
	}

	console.log("Oh noes! No available happenings!!!");
	return {
		client: {
			title: ["Oh noes! Something bad happened!"],
			options: ["Cool!"]
		}, server: [function() {}]
	}
}

function createHappening(gameid) {
	if(games[gameid].happening.client === undefined) {
		games[gameid].happening = getRandomHappening(gameid);
		sendToGame(gameid, "happening", games[gameid].happening.client);
	}
}

function randomFromArray(array) {
	return array[randomInt(array.length)];
}

function getNames(gameid) {
	var male = [
		"Niilo-Matti", "Nikodemus", "Herpertti", "Unkelo", "Tunkeli", "Zizek", "Jeppe", "Rolle-Aleksi", "Pentti", "Yrjo-Helmeri", "Joose-Kissa", "Olli-Ilmari", "Henkseli", "Jontte", "Retu", "Pena", "Kives-Joosef", "Valtteri", "Pikku-Petteri", "Anton"
	];
	var female = [
		"Anni-Inkeri", "Vilhelmiina", "Anna-Kaarina", "Sanni", "Senni", "Sonni", "Henna-Eerika", "Anna-Maarikka", "Paula-Helena", "Reetu-Liina", "Ritu", "Antonia", "Kukka-Maaria", "Marja-Kaisa", "Anne-Elina", "Sinikka"
	];
	
	if(games[gameid].marker.sex === "male") var pool = male;
	else var pool = female;
	
	var sames = true;
	while(sames) {
		var chosen = [randomFromArray(pool), randomFromArray(pool), randomFromArray(pool) ];
		
		sames = (chosen[0] === chosen[1]) || (chosen[1] === chosen[2]) || (chosen[0] === chosen[2]);
	}

	return chosen;
}

staticFiles.forEach(function(data) {
	app.get(data.get, function(req, res) {
		res.sendFile(public_dir + data.give);
	});
});

app.get("/game", function(req, res) {
	if(url.parse(req.url, true).query["game"] === undefined || url.parse(req.url, true).query["game"].replace(new RegExp(" ", "g"), "") === "") {
		res.sendFile(public_dir + "/game/index.html");
	} else if(checkPin(url.parse(req.url, true).query["game"].toLowerCase(), url.parse(req.url, true).query["pin"])) {
		res.sendFile(public_dir + "/game/game.html");
	} else {
		res.sendFile(public_dir + "/game/wrongpin.html");
	}
});

http.listen(port, function() {
	console.log("Listening on port " + port);
});

io.on("connection", function(socket) {
	var userid = randomId();
	
	// Game connection stuff
	var gamename = socket.handshake.headers.referer.split("game=")[1].split("&")[0];
	var gameid = getGame(gamename.toLowerCase());
	
	// Add player to stack
	games[gameid].players[games[gameid].players.length] = userid;

	// Add socket to the bunch
	sockets[sockets.length] = socket;
	sockets[sockets.length] = gameid;
	sockets[sockets.length] = userid;

	// Send things
	socket.emit("activity", games[gameid].activity);
	socket.emit("roomchange", games[gameid].room);
	socket.emit("marker", games[gameid].marker);
	socket.emit("tvprogramme", randomFromArray(programmes));
	if(games[gameid].marker.age >= 6)
					sendToGame(gameid, "done", {attachement: Math.ceil(games[gameid].attrs.attachement), happiness: Math.ceil(games[gameid].attrs.happiness)});

	if(games[gameid].happening.client !== undefined) {
		console.log("sending happening that's already there");
		sendToGame(gameid, "happening", games[gameid].happening.client);
	} else {
		console.log("sending clear happening");
		sendToGame(gameid, "happening", []);
	}

	console.log("New connection from " + socket.handshake.address + ", userid " + userid + ", gamename " + gamename);

	socket.on("roomchange", function(room) {
		if(arrayContains(possibleRooms, room)) {
			if(getQueuePos(gameid, userid) <= 2) {
				sendToGame(gameid, "roomchange", room);
				games[gameid].room = room;
			} else console.log(userid + " can't change the room with priority " + getQueuePos(gameid, userid));
		} else console.log(userid + " just tried to change the room to '" + room + "', suspicious!");
	});

	socket.on("activity", function() {
		var allowed = true;
		for(var i = 0; i < idleActivityAllowed.length; i++)
			if(idleActivityAllowed[i] === userid)
				allowed = false;
		
		if(allowed) {
			addActivity(gameid, getPriority(gameid, userid));
			
			idleActivityAllowed[idleActivityAllowed.length] = userid;
			setTimeout(function() {
				for(var i = 0; i < idleActivityAllowed.length; i++)
					if(idleActivityAllowed[i] === userid)
						idleActivityAllowed[i] = undefined;
			}, 9000);
		} else console.log(userid + " not allowed to gain activity again so fast!");
	});

	socket.on("answer", function(answer) {
		console.log("Received answer " + answer);
		if(answer >= 0 && answer < games[gameid].happening.server.length) {
			games[gameid].happening.server[answer]();
			sendToGame(gameid, "happening", []);
			games[gameid].happening = [];
		}
	});

	socket.on("newprogramme", function() {
		socket.emit("tvprogramme", randomFromArray(programmes));
	});

	socket.on("watching_tv", function() {
		games[gameid].attrs.attachement -= 0.02;
		games[gameid].attrs.happiness += 0.02;
		console.log(gameid + "'s child watched a bit of TV");
	});

	socket.on("disconnect", function() {
		removePlayerFromGame(gameid, userid);

		console.log("Disconnected: " + socket.handshake.address);
	});
});

(function() {
	// Save data
	setInterval(function() {
		fs.writeFile("games.json", JSON.stringify(games), "utf8");
		fs.writeFile("pins.json", JSON.stringify(pins), "utf8");
	}, 10000);

	setInterval(function() {
		for(var i = 0; i < games.length; i++) {
			if(games[i].marker.name == undefined) {
				console.log("no name yet for " + i);
				return;
			}

			if(randomBoolean() && games[i].marker.age <= 5) createHappening(i);
		}
	}, 60000);

	// Moving markers
	setInterval(function() {
		for(var i = 0; i < games.length; i++) {
			sendToGame(i, "startmoving", {
				x: randomInt(roomBounds[games[i].room].x2 - roomBounds[games[i].room].x1) + roomBounds[games[i].room].x1,
				y: randomInt(roomBounds[games[i].room].y2 - roomBounds[games[i].room].y1) + roomBounds[games[i].room].y1
			});
			sendToGame(i, "marker", games[i].marker);

			if(games[i].upgrade <= 0) {
				games[i].upgrade = 3;
				games[i].marker.age++;
				console.log(i + "'s child leveled up to age " + games[i].marker.age);
				sendToGame(i, "marker", games[i].marker);
				if(games[i].marker.age >= 6)
					sendToGame(i, "done", {attachement: Math.ceil(games[i].attrs.attachement), happiness: Math.ceil(games[i].attrs.happiness)});
			}
		}
	}, 3000);
})();
