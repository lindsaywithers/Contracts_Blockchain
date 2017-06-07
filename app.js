'use strict';
/* global process */
/* global __dirname */

var express = require('express');
var session = require('express-session');
var compression = require('compression');
var path = require('path');
var morgan = require('morgan');
var bodyParser = require('body-parser');
var http = require('http');
var app = express();
var url = require('url');
var setup = require('./setup');
var fs = require('fs');
var cors = require('cors');
var host = setup.SERVER.HOST;
var port = setup.SERVER.PORT;
var extend = require('extend');
var Ibc1 = require('ibm-blockchain-js');														//rest based SDK for ibm blockchain
var ibc = new Ibc1();
var peers = null;
var users = null;	
var chaincode = null;	

var GDS = require('ibm-graph-client');
var GDScreds = null;

var md5 = require('md5');

app.use(compression());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded()); 											

app.options('*', cors());
app.use(cors());

if(process.env.VCAP_SERVICES){																	//load from vcap, search for service, 1 of the 3 should be found...
	var servicesObject = JSON.parse(process.env.VCAP_SERVICES);
	for(var i in servicesObject){
		if(i.indexOf('ibm-blockchain') >= 0){													
			if(servicesObject[i][0].credentials && servicesObject[i][0].credentials.peers){		
				console.log('overwritting peers, loading from a vcap service: ', i);
				peers = servicesObject[i][0].credentials.peers;
				if(servicesObject[i][0].credentials.users){										//user field may or maynot exist, depends on if there is membership services or not for the network
					console.log('overwritting users, loading from a vcap service: ', i);
					users = servicesObject[i][0].credentials.users;
				} 
				else users = null;																
			}
		}
		if(i.indexOf('IBM Graph') >= 0){													
			if(servicesObject[i][0].credentials){		
				console.log('loading graph from a vcap service: ', i);
				GDScreds = servicesObject[i][0].credentials;
			}
		}
	}
}

var graphD = new GDS(GDScreds);
var graph = "contract";
graphD.session(function(err, data) {
  if (err) {
    console.log(err);
  } else {
    graphD.config.session = data;
    console.log("Your graph session token is " + data);
  }
});


graphD.graphs().set(graph, function(err, data){
  if (err) {
    console.log("Graph error:" + err);
  }
  console.log("Set active Graph:" + graph);
});


//filter for type1 users if we have any
function prefer_type1_users(user_array){
	var ret = [];
	for(var i in users){
		if(users[i].enrollId.indexOf('type1') >= 0) {	//gather the type1 users
			ret.push(users[i]);
		}
	}

	if(ret.length === 0) ret = user_array;				//if no users found, just use what we have
	return ret;
}

//see if peer 0 wants tls or no tls
function detect_tls_or_not(peer_array){
	var tls = false;
	if(peer_array[0] && peer_array[0].api_port_tls){
		if(!isNaN(peer_array[0].api_port_tls)) tls = true;
	}
	return tls;
}

// ==================================
// configure options for ibm-blockchain-js sdk
// ==================================
var options = 	{
	network:{
		peers: [peers[0]],																	//lets only use the first peer! since we really don't need any more than 1
		users: prefer_type1_users(users),													//dump the whole thing, sdk will parse for a good one
		options: {
				quiet: true, 															//detailed debug messages on/off true/false
				tls: detect_tls_or_not(peers), 											//should app to peer communication use tls?
				maxRetry: 1																//how many times should we retry register before giving up
			}
	},
	chaincode:{
		zip_url: 'https://github.com/garrettrowe/Contracts_Blockchain/archive/master.zip',
		unzip_dir: 'Contracts_Blockchain-master/chaincode',													//subdirectroy name of chaincode after unzipped
		git_url: 'https://github.com/garrettrowe/Contracts_Blockchain/chaincode'
	}
};
																	//sdk will populate this var in time, lets give it high scope by creating it here
ibc.load(options, function (err, cc){														//parse/load chaincode, response has chaincode functions!
	if(err != null){
		console.log('! looks like an error loading the chaincode or network, app will fail\n', err);
		if(!process.error) process.error = {type: 'load', msg: err.details};				//if it already exist, keep the last error
	}
	else{
		chaincode = cc;
		if(!cc.details.deployed_name || cc.details.deployed_name === ''){					//yes, go deploy
			cc.deploy('init', ['99'], {delay_ms: 30000}, function(e){ 						//delay_ms is milliseconds to wait after deploy for conatiner to start, 50sec recommended
				check_if_deployed(e, 1);
			});
		}
		else{																				//no, already deployed
			console.log('chaincode summary file indicates chaincode has been previously deployed');
			check_if_deployed(null, 1);
		}
	}
});

//loop here, check if chaincode is up and running or not
function check_if_deployed(e, attempt){
	if(e){
		cb_deployed(e);																		//looks like an error pass it along
	}
	else if(attempt >= 15){																	//tried many times, lets give up and pass an err msg
		console.log('[preflight check]', attempt, ': failed too many times, giving up');
		var msg = 'chaincode is taking an unusually long time to start. this sounds like a network error, check peer logs';
		if(!process.error) process.error = {type: 'deploy', msg: msg};
		cb_deployed(msg);
	}
	else{
		console.log('[preflight check]', attempt, ': testing if chaincode is ready');
		chaincode.query.read(['_contractindex'], function(err, resp){
			var cc_deployed = false;
			try{
				if(err == null){															//no errors is good, but can't trust that alone
					if(resp === 'null') cc_deployed = true;									//looks alright, brand new, no contracts yet
					else{
						var json = JSON.parse(resp);
						if(json.constructor === Array) cc_deployed = true;					//looks alright, we have contracts
					}
				}
			}
			catch(e){}																		//anything nasty goes here
			if(!cc_deployed){
				console.log('[preflight check]', attempt, ': failed, trying again');
				setTimeout(function(){
					check_if_deployed(null, ++attempt);										//no, try again later
				}, 10000);
			}
			else{
				console.log('[preflight check]', attempt, ': success');
				cb_deployed(null);															//yes, lets go!
			}
		});
	}
}

function cb_deployed(e){
	if(e != null){
		console.log('Deploy error: \n', e);
		if(!process.error) process.error = {type: 'deploy', msg: e.details};
	}
	else{
		console.log('Deployed Sucessfully\n');
	}
}


app.use(function(req, res, next){
	var keys;
	console.log('------------------------------------------ incoming request ------------------------------------------');
	console.log('New ' + req.method + ' request for', req.url);
	
	var url_parts = url.parse(req.url, true);
	req.parameters = url_parts.query;
	keys = Object.keys(req.parameters);
	if(req.parameters && keys.length > 0) console.log({parameters: req.parameters});		//print request parameters for debug
	keys = Object.keys(req.body);
	if (req.body && keys.length > 0) console.log({body: req.body});							//print request body for debug
	next();
});

var router = express.Router(); 

router.get('/', function(req, res) {
    res.json({ message: 'This is a webapp' });   
});

router.get('/chainstats', function(req, res) {
    res.json(ibc.chain_stats(cb_chainstats));   
});

router.route('/create').post(function(req, res) {
	chaincode.invoke.init_contract([req.body.name, req.body.startdate, req.body.enddate, req.body.location, req.body.text, req.body.party1, req.body.party2, req.body.title ], retCall)
	function retCall(e, a){
		console.log('Blockchain created entry: ', e, a);
	}

	
	var gremlinq = {
	  gremlin: "\
	def party1 =  graph.addVertex(T.label, 'party', 'name', party1);\
	def party2 =  graph.addVertex(T.label, 'party', 'name', party2);\
	def contract = graph.addVertex(T.label, 'contract', 'name', contractName, 'hash', hash, 'title', title);\
	def location = graph.addVertex(T.label, 'location', 'location', location);\
	contract.addEdge('parties', party1);\
	contract.addEdge('parties', party2);\
	contract.addEdge('locations', location);",
	  "bindings": {
	    "party1": req.body.party1,
	    "party2": req.body.party2,
	    "contractName": req.body.name,
	    "hash": md5(req.body.text),
		"title": req.body.title,
		"location": req.body.location
	  }
	}
	graphD.gremlin(gremlinq, function(err,data){
	  if (err) {
	    console.log(err);
	  }
	  console.log(JSON.stringify(data));
	});
	res.json({ message: 'Transaction Complete' });
});

router.route('/index').post(function(req, res) {
	chaincode.query.read(['_contractindex'], retCall)
	function retCall(e, a){
		console.log('Index returns: ', e, a);
		res.json(a);
	}
});

router.route('/delete').post(function(req, res) {
	chaincode.invoke.delete([req.body.name], retCall)
	function retCall(e, a){
		console.log('Blockchain returns: ', e, a);
		res.json(a);
	}
});

router.route('/read').post(function(req, res) {
	chaincode.query.read([req.body.name], retCall)
	function retCall(e, a){
		console.log('Blockchain returns: ', e, a);
		res.json(a);
	}
});

router.route('/querylocation').post(function(req, res) {
	var gremlinq = {
	  "gremlin": "graph.traversal().V().has('location', location).bothE().outV();",
	  "bindings": { "location": req.body.location }
	}
	graphD.gremlin(gremlinq, function(err,odata){
	  if (err) {
	    console.log('Error: ' + err);
	  }
	  console.log(JSON.stringify(odata));
		var resp = {};
		var contract = null;
		for (var i = 0, len = odata.result.data.length; i < len; i++) {
		  contract = odata.result.data[0].properties.name[0].value;
		  console.log('Contract found: ' + contract);
		chaincode.query.read([contract], function (e, a){
				console.log('Blockchain returns: ', e, a);
				extend(resp,a);
			});
		}
		res.json({"results": resp});
	});

	
});



router.get('/graphinit', function(req, res) {
var schema = {
  "propertyKeys": [
    {"name": "name", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "location", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "title", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "party", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "enddate", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "startdate", "dataType": "String", "cardinality": "SINGLE"},
    {"name": "hash", "dataType": "String", "cardinality": "SINGLE"}
  ],
  "vertexLabels": [
    {"name": "party"},
    {"name": "contract"},
    {"name": "location"}
  ],
  "edgeLabels": [
    {"name": "parties", "multiplicity": "MULTI"},
    {"name": "locations", "multiplicity": "MULTI"}
  ],
  "vertexIndexes": [
    {"name": "vByContract", "propertyKeys": ["name"], "composite": true, "unique": true},
    {"name": "vByLocation", "propertyKeys": ["location"], "composite": true, "unique": true},
    {"name": "vByParty", "propertyKeys": ["party"], "composite": true, "unique": true}
  ],
  "edgeIndexes" :[
    {"name": "eByParties", "propertyKeys": ["party"], "composite": true, "unique": false},
    {"name": "eByLocations", "propertyKeys": ["location"], "composite": true, "unique": false}  
  ]
}
graphD.config.url = graphD.config.url.substr(0, graphD.config.url.lastIndexOf('/') + 1) + graph;
graphD.schema().set(schema, function(err, data){
  if (err) {
    console.log(err);
  }
  res.json(data);
}); 
});

app.use('/api', router);

app.use(function(req, res, next) {
	err.status = 404;
	next(err);
});
app.use(function(err, req, res, next) {														// = development error handler, print stack trace
	console.log('Error Handeler -', req.url);
	var errorCode = err.status || 500;
	res.status(errorCode);
	res.json({msg:err.stack, status:errorCode});
});


// ============================================================================================================================
// 														Launch Webserver
// ============================================================================================================================
var server = http.createServer(app).listen(port, function() {});
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.NODE_ENV = 'production';
server.timeout = 240000;																							// Ta-da.
console.log('------------------------------------------ Server Up - ' + host + ':' + port + ' ------------------------------------------');
