var app 	= require('express')();
var server 	= require('http').Server(app);
var io 		= require('socket.io')(server);
var sql 	= require('./sql');
var crypto  = require('crypto');

// Chunk server.
var clients = {};
var GameParam = {
	SupraBomba : {

	}
}

var Rooms = {};
var Chats = {};

// Function du HUB.
var size = function(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};

function AppplicationError(msg) {
	return console.log(msg+" -> "+socket.id);
}

function CheckVar(variable,min,max) {
	if( variable !== null && variable !== undefined && variable.length >= min && variable.length <= max) {
		return true;
	}
	return false;
}

function SocketAlready_Connected(login) {
	for(var i in clients) {
		if(clients[i].login == login) {
			return false;
		}
	}
	return true;
}

function DeleteFromClient(id,type) {
	var tmp_name = id;
	if(clients[id].login != null) {
		tmp_name = clients[id].login;
	}
	if(type == "brutal") {
		clients[id] = null;
		delete clients[id];
	}
	else {
		clients[id] = {
			sid : id,
			login : null,
			avatar : null,
			points : 0,
			rights : 0,
			activeroom : null,
			friends : null,
			chats : null
		};
	}
	console.log("user -> '"+tmp_name+"' "+type+" logout.");
}


function GetClientFromRoom(room) {
	var connectedClients = io.nsps["/"].adapter.rooms[room];
	var tmp_user = {};
	for(var a in connectedClients) {
		for(var b in clients) {
			if(a == b) {
				var env = clients[b];
				tmp_user[env.login] = {
					login : env.login,
					avatar : env.avatar
				}
			}
		}
	}

	return tmp_user;
}

function GetID(name) {
	for(var i in clients) {
		if(clients[i].login == name) {
			return clients[i].sid;
		}
	}
}

function makeIdentifier(max){
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < max; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

// Connexion a socket.io
io.on('connection', function (socket) {

	// Store clients informations.
	clients[socket.id] = {
		sid : socket.id,
		login : null,
		identifier : null,
		avatar : null,
		points : 0,
		rights : 0,
		activeroom : null,
		friends : null,
		chats : {}
	};

	// Log connection.
	console.log(socket.id+" -> now logged to the server");

	// When a user trying to connect to the server.
	socket.on('userRequest_connection',function(req) {
		// req.login : string : max 20
		// req.password : string : max 20 

		if(clients[socket.id].login == null) {

			// On vérifie que nos variables sont valides.
			var check_login 	= CheckVar(req.login,3,20);
			var check_password 	= CheckVar(req.password,6,20);

			// On vérifie que l'utilisateur n'est pas déjà connecté.
			var SocketConnected = SocketAlready_Connected(req.login); 

			if(SocketConnected) {
				if(check_login && check_password) {

					// On hash le mot de passe en md5 
					var tmp_password = crypto.createHash('md5').update(req.password).digest('hex');

					// On recherche un résultat dans la database.
					sql.select('SELECT * FROM db_user WHERE login = "'+req.login+'" and password = "'+tmp_password+'"',function(results,error,fields) {
						if(results.length > 0) {
							socket.emit('userConnection',{
								nfo : {
									login  : results[0].login,
									avatar : results[0].avatar,
									rights : results[0].rights
								}, 
								state : true
							});
							var user = clients[socket.id];
							user.login = results[0].login;
							user.identifier = results[0].id;
							user.avatar = results[0].avatar;
							user.rights = results[0].rights;

							console.log(socket.id+" have now for user login -> "+user.login);
						}
						else {
							console.log(socket.id+" / "+req.login+" -> failed to login to the HUB");
							socket.emit('userConnection',{
								state : false,
								err : "Login ou motdepasse incorrect"
							});
						}
					}); 

					// Prevent from brutal out_disconnect.
					clients[socket.id].activeroom = null;
				}
			}
			else {
				// User is already connected ! 
				console.log("User -> "+req.login+" is already connected");
			}
		}
		else {
			console.log("client "+clients[socket.id].login+" is already connected");
		}
	});

	socket.on('userRequest_logout',function(req) {
		if( friendsDisconnect() ) {
			console.log("exec logout");
			DeleteFromClient(socket.id,"normal");
			socket.emit('userDeconnection',{});
		}
	});

	socket.on('userRequest_inviteConnexion',function(req) {
		if(clients[socket.id].login == null) {
			var ID = Math.floor((Math.random() * 9999) + 1);
			var login = "invite"+ID;

			var SocketConnected = SocketAlready_Connected(login); 

			if(SocketConnected) {
				var user = clients[socket.id];

				user.login = login; 
				user.rights = 0;
				user.avatar = "01";

				socket.emit('userConnection',{
					nfo : {
						login  : user.login,
						avatar : "01",
						rights : user.rights
					}, 
					state : true
				});

				console.log(socket.id+" have now for user login -> "+user.login);
			}
			else {
				console.log("User -> "+login+" is already connected");
			}
		}
		else {
			console.log("client "+clients[socket.id].login+" is already connected");
		}
	});

	socket.on('userRequest_socialConnexion',function(req) {

	});

	socket.on('registered_newUser',function(req) {
		var tmp_password = crypto.createHash('md5').update(req.password).digest('hex');

		sql.insert('INSERT INTO db_user SET ?',{id:null, login:req.login, password:tmp_password, rights: 1}, function() {
			console.log("User successfully registered");
		});
	});

	socket.on('userRequest_friendslist', function(req) {
		var ID = clients[socket.id].identifier;
		clients[socket.id].friends = null;

		sql.select('SELECT * FROM db_friends WHERE userid = "'+ID+'"',function(results) {
			if(results.length > 0) {
				list = results[0].list.split(";");
				var hydrate_Friendslist = {}; 
				var LS = size(list);

				// Find information froms friends!
				for(var i in list) {
					var env = list[i]; 

					sql.select('SELECT * FROM db_user WHERE id="'+env+'"',function(results) {
						if(results.length > 0) {
							var online = false;
							var sid = null;
							for(var a in clients) {
								if (clients[a].login == results[0].login) { 
									online = true;
									sid = a;
									break;
								}
							}

							hydrate_Friendslist[results[0].login] = {
								login : results[0].login,
								avatar : results[0].avatar,
								online : online
							}

							if(online) {
								io.to(sid).emit('friends_userConnect',{
									login : clients[socket.id].login,
									avatar : clients[socket.id].avatar
								});
								var userNFO = clients[sid]; 
								clients[sid].friends[clients[socket.id].login].online = true;
							}

							if( size(hydrate_Friendslist) == LS ) {
								clients[socket.id].friends = hydrate_Friendslist;
								socket.emit('friends_Hydrate',hydrate_Friendslist);
							}
						}
					});
				}

			}
			else {
				console.log("AIE! You have no friends");
			}
		});

	});
	
	socket.on('userRequest_chat',function(req) {
		// req.focusUser 

		var focusUser = GetID(req.focusUser); 
		if(clients[socket.id].chats[req.focusUser] !== undefined) {

		}
		else if( clients[focusUser].chats[clients[socket.id].login] ) {
			
		}
		else {
			
		}
	});

	socket.on('userRequest_serverList',function(req) {
		socket.emit('serverPush',{rooms:Rooms});
	});

	socket.on('userRequest_createGame',function(req) {
		// req.gameName
        // req.gamePassword
        // req.playerMAX
        // req.timeLimit
        // req.gameMode 

        req.gameName = req.gameName.split(' ').join('_').toLowerCase().toString();

        var RoomEnv = Rooms[req.gameName];
        if(RoomEnv == null && clients[socket.id].activeroom == null) {

        	// Create game info.
        	Rooms[req.gameName] = {
        		roomID : makeIdentifier(10),
				roomName : req.gameName,
				roomConnected : 1,
				roomMaxConnected : req.playerMAX,
				roomPassword : req.gamePassword,
				roomAdministrator : socket.id,
				roomSpectator : {},
				roomConfig : {
					Tchat : false
				},
				gameConfig : {
					gameMode : req.gameMode
				}
        	}

        	console.log("Game create with name -> "+req.gameName);

        	socket.emit('joinLobby',{
        		roomName : req.gameName,
        		user : clients[socket.id].login,
        		isAdmin : true
        	});

        	socket.broadcast.emit('addLobby',{
        		roomName : req.gameName,
        		roomPassword : null,
        		roomConnected : 1,
        		gameMode : req.gameMode,
        		roomMaxConnected : req.playerMAX
        	});

        	// Join room for creator.
        	socket.join(req.gameName);
        	clients[socket.id].activeroom = req.gameName;

        }
        else {
        	console.log("clients -> "+clients[socket.id].login+" failed to create a game.");
        } 
	});

	socket.on('userRequest_joinRoom',function(req) {
		// req.name

		console.log("user -> "+clients[socket.id].login+" request to join a room");
		if(Rooms[req.name] != null && clients[socket.id].activeroom == null) {

			var env = Rooms[req.name]; 

			var playerConnected_Before = env.roomConnected; 
			var playerConnected_After = env.roomConnected + 1;
			
			if(playerConnected_After <= env.roomMaxConnected) {

				var connectedClients = GetClientFromRoom(req.name);

				socket.emit('userJoin_lobby',connectedClients);

				socket.emit('joinLobby',{
					roomName : req.name,
					user : clients[socket.id].login,
					isAdmin : false
				});

				socket.broadcast.to(req.name).emit('userJoin_lobby',{
					user : clients[socket.id].login
				});

				socket.join(req.name);
				clients[socket.id].activeroom = req.name;
			}
			else {
				console.log("Lobby is full");
			}
		}
		else {
			console.log("user -> "+clients[socket.id].login+" failed to join a room");
		}
	});

	// Function for testing and removing player from lobby. (or destroying empty lobby).
	function RemovePlayer() {
		if(clients[socket.id].activeroom != null) {
			var RoomExited = clients[socket.id].activeroom;
			var RoomNFO = Rooms[RoomExited]; 

			if(RoomNFO != null) {
				var RoomPlayerConnected_After = RoomNFO.roomConnected - 1;

				socket.leave(RoomExited);
				clients[socket.id].activeroom = null;

				console.log("client -> '"+clients[socket.id].login+"' leave the room -> "+RoomExited);

				if(RoomPlayerConnected_After <= 0) {
					Rooms[RoomExited] = undefined;
					delete Rooms[RoomExited];

					console.log("destroying room -> "+RoomExited);

					io.sockets.emit('deleteLobby', {
						roomName : RoomExited
					});
				}
				else {
					socket.broadcast.to(RoomExited).emit('userLeave_lobby',{
						roomName : clients[socket.id].login
					});

					// Si le joueur était administrateur de la partie
					if(Rooms[RoomExited].roomAdministrator == socket.id) {

					}

					Rooms[RoomExited].roomConnected -= 1;

					socket.broadcast.emit('updateLobby',{
						roomName : RoomExited,
						roomConnected : Rooms[RoomExited].roomConnected,
						roomMaxConnected : Rooms[RoomExited].roomMaxConnected
					});
				}
			}
		}
	}

	function friendsDisconnect() {
		var userNFO = clients[socket.id]; 

		if(userNFO.rights == 1) {
			for(var i in userNFO.friends) {
				var env = userNFO.friends[i]; 

				if(env.online) {
					var focusUserID = GetID(env.login); 
					io.to(focusUserID).emit('friends_userDisconnect',{login : userNFO.login,avatar : userNFO.avatar});
					clients[focusUserID].friends[userNFO.login].online = false;
				}
			}
		}

		return true;
	}

	socket.on('userRequest_disconnectRoom',function(req) {
		RemovePlayer();
		socket.emit('disconnectLobby',{});
	});

	// Disconnect user from socket.
	socket.on('disconnect', function () {
		if ( friendsDisconnect() ) {
			RemovePlayer();
			DeleteFromClient(socket.id,"brutal");
		}
	});

});

server.listen(7076,"0.0.0.0");
