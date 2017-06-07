package main

import (
	"errors"
	"fmt"
	"strconv"
	"encoding/json"
	"time"

	"github.com/hyperledger/fabric/core/chaincode/shim"
)

// SimpleChaincode example simple Chaincode implementation
type SimpleChaincode struct {
}

var contractIndexStr = "_contractindex"				//name for the key/value that will store a list of all known contracts

type Contract struct{
	Name string `json:"name"`					
	StartDate string `json:"startdate"`
	EndDate string `json:"enddate"`
	Location string `json:"location"`
	Text string `json:"text"`
	Company1 string `json:"company1"`
	Company2 string `json:"company2"`
	Title string `json:"title"`
}




// ============================================================================================================================
// Main
// ============================================================================================================================
func main() {
	err := shim.Start(new(SimpleChaincode))
	if err != nil {
		fmt.Printf("Error starting Simple chaincode: %s", err)
	}
}

// ============================================================================================================================
// Init - reset all the things
// ============================================================================================================================
func (t *SimpleChaincode) Init(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	var Aval int
	var err error

	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting 1")
	}

	// Initialize the chaincode
	Aval, err = strconv.Atoi(args[0])
	if err != nil {
		return nil, errors.New("Expecting integer value for asset holding")
	}

	// Write the state to the ledger
	err = stub.PutState("abc", []byte(strconv.Itoa(Aval)))				//making a test var "abc", I find it handy to read/write to it right away to test the network
	if err != nil {
		return nil, err
	}
	
	var empty []string
	jsonAsBytes, _ := json.Marshal(empty)								//marshal an emtpy array of strings to clear the index
	err = stub.PutState(contractIndexStr, jsonAsBytes)
	if err != nil {
		return nil, err
	}
	
	return nil, nil
}

// ============================================================================================================================
// Run - Our entry point for Invocations - [LEGACY] obc-peer 4/25/2016
// ============================================================================================================================
func (t *SimpleChaincode) Run(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("run is running " + function)
	return t.Invoke(stub, function, args)
}

// ============================================================================================================================
// Invoke - Our entry point for Invocations
// ============================================================================================================================
func (t *SimpleChaincode) Invoke(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("invoke is running " + function)

	// Handle different functions
	if function == "init" {													//initialize the chaincode state, used as reset
		return t.Init(stub, "init", args)
	} else if function == "delete" {										//deletes an entity from its state
		res, err := t.Delete(stub, args)													//lets make sure all open trades are still valid
		return res, err
	} else if function == "write" {											//writes a value to the chaincode state
		return t.Write(stub, args)
	} else if function == "init_contract" {									//create a new contract
		return t.init_contract(stub, args)
	} else if function == "set_user" {										//change owner of a contract
		res, err := t.set_user(stub, args)													//lets make sure all open trades are still valid
		return res, err
	} 
	fmt.Println("invoke did not find func: " + function)					//error

	return nil, errors.New("Received unknown function invocation")
}

// ============================================================================================================================
// Query - Our entry point for Queries
// ============================================================================================================================
func (t *SimpleChaincode) Query(stub shim.ChaincodeStubInterface, function string, args []string) ([]byte, error) {
	fmt.Println("query is running " + function)

	// Handle different functions
	if function == "read" {													//read a variable
		return t.read(stub, args)
	}
	fmt.Println("query did not find func: " + function)						//error

	return nil, errors.New("Received unknown function query")
}

// ============================================================================================================================
// Read - read a variable from chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) read(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var name, jsonResp string
	var err error

	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting name of the var to query")
	}

	name = args[0]
	valAsbytes, err := stub.GetState(name)									//get the var from chaincode state
	if err != nil {
		jsonResp = "{\"Error\":\"Failed to get state for " + name + "\"}"
		return nil, errors.New(jsonResp)
	}

	return valAsbytes, nil													//send it onward
}

// ============================================================================================================================
// Delete - remove a key/value pair from state
// ============================================================================================================================
func (t *SimpleChaincode) Delete(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	if len(args) != 1 {
		return nil, errors.New("Incorrect number of arguments. Expecting 1")
	}
	
	name := args[0]
	err := stub.DelState(name)													//remove the key from chaincode state
	if err != nil {
		return nil, errors.New("Failed to delete state")
	}

	//get the contract index
	contractsAsBytes, err := stub.GetState(contractIndexStr)
	if err != nil {
		return nil, errors.New("Failed to get contract index")
	}
	var contractIndex []string
	json.Unmarshal(contractsAsBytes, &contractIndex)								//un stringify it aka JSON.parse()
	
	//remove contract from index
	for i,val := range contractIndex{
		fmt.Println(strconv.Itoa(i) + " - looking at " + val + " for " + name)
		if val == name{															//find the correct contract
			fmt.Println("found contract")
			contractIndex = append(contractIndex[:i], contractIndex[i+1:]...)			//remove it
			for x:= range contractIndex{											//debug prints...
				fmt.Println(string(x) + " - " + contractIndex[x])
			}
			break
		}
	}
	jsonAsBytes, _ := json.Marshal(contractIndex)									//save new index
	err = stub.PutState(contractIndexStr, jsonAsBytes)
	return nil, nil
}

// ============================================================================================================================
// Write - write variable into chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) Write(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var name, value string // Entities
	var err error
	fmt.Println("running write()")

	if len(args) != 2 {
		return nil, errors.New("Incorrect number of arguments. Expecting 2. name of the variable and value to set")
	}

	name = args[0]															//rename for funsies
	value = args[1]
	err = stub.PutState(name, []byte(value))								//write the variable into the chaincode state
	if err != nil {
		return nil, err
	}
	return nil, nil
}

// ============================================================================================================================
// Init Contract - create a new contract, store into chaincode state
// ============================================================================================================================
func (t *SimpleChaincode) init_contract(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var err error
	
	if len(args) != 8 {
		return nil, errors.New("Incorrect number of arguments. Expecting 8")
	}
	fmt.Println("- start init contract")
	name := args[0]
	startdate := args[1]
	enddate := args[2]
	location := args[3]
	text := args[4]
	company1 := args[5]
	company2 := args[6]
	title := args[7]

	//check if contract already exists
	contractAsBytes, err := stub.GetState(name)
	if err != nil {
		return nil, errors.New("Failed to get contract name")
	}
	res := Contract{}
	json.Unmarshal(contractAsBytes, &res)
	if res.Name == name{
		fmt.Println("This contract arleady exists: " + name)
		fmt.Println(res);
		return nil, errors.New("This contract arleady exists")				//all stop a contract by this name exists
	}
	
	//build the contract json string manually
	str := `{"name": "` + name + `","title": "` + title + `", "startdate": "` + startdate + `", "enddate": "` + enddate + `", "location": "` + location + `", "text": "` + text + `", "company1": "` + company1 + `", "company2": "` + company2 + `"}`
	err = stub.PutState(name, []byte(str))									//store contract with id as key
	if err != nil {
		return nil, err
	}
		
	//get the contract index
	contractsAsBytes, err := stub.GetState(contractIndexStr)
	if err != nil {
		return nil, errors.New("Failed to get contract index")
	}
	var contractIndex []string
	json.Unmarshal(contractsAsBytes, &contractIndex)							//un stringify it aka JSON.parse()
	
	//append
	contractIndex = append(contractIndex, name)									//add contract name to index list
	fmt.Println("! contract index: ", contractIndex)
	jsonAsBytes, _ := json.Marshal(contractIndex)
	err = stub.PutState(contractIndexStr, jsonAsBytes)						//store name of contract

	fmt.Println("- end init contract")
	return nil, nil
}

// ============================================================================================================================
// Set User Permission on Contract
// ============================================================================================================================
func (t *SimpleChaincode) set_user(stub shim.ChaincodeStubInterface, args []string) ([]byte, error) {
	var err error
	
	if len(args) < 2 {
		return nil, errors.New("Incorrect number of arguments. Expecting 2")
	}
	
	fmt.Println("- start set user")
	fmt.Println(args[0] + " - " + args[1])
	contractAsBytes, err := stub.GetState(args[0])
	if err != nil {
		return nil, errors.New("Failed to get thing")
	}
	res := Contract{}
	json.Unmarshal(contractAsBytes, &res)										//un stringify it aka JSON.parse()
	res.Company1 = args[1]														//change the user
	
	jsonAsBytes, _ := json.Marshal(res)
	err = stub.PutState(args[0], jsonAsBytes)								//rewrite the contract with id as key
	if err != nil {
		return nil, err
	}
	
	fmt.Println("- end set user")
	return nil, nil
}

// ============================================================================================================================
// Make Timestamp - create a timestamp in ms
// ============================================================================================================================
func makeTimestamp() int64 {
    return time.Now().UnixNano() / (int64(time.Millisecond)/int64(time.Nanosecond))
}

