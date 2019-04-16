const TestableMiximus = artifacts.require("TestableMiximus");

const crypto = require("crypto");

const fs = require("fs");
const ffi = require("ffi");
const ref = require("ref");
const ArrayType = require("ref-array");
const BN = require("bn.js");

var StringArray = ArrayType(ref.types.CString);

const MiximusVerifyingKeyPath = "../.keys/miximus.vk.json";
const MiximusProvingKeyPath = "../.keys/miximus.pk.raw";

var libmiximus = ffi.Library("../.build/libmiximus", {
    // Retrieve depth of tree
    "miximus_tree_depth": [
        "size_t", []
    ],

    // Create a proof for the parameters
    "miximus_prove": [
        "string", [
            "string",       // pk_file
            "string",       // in_root
            "string",       // in_exthash
            "string",       // in_spend_preimage
            "string",       // in_address
            StringArray,    // in_path
        ]
    ],

    // Verify a proof
    "miximus_verify": [
        "bool", [
            "string",   // vk_json
            "string",   // proof_json
        ]
    ],

    // Create nullifier
    "miximus_nullifier": [
        "string", [
            "string",   // secret (base 10 number)
            "string",   // leaf_index (base 10 number)
        ]
    ]
});



let list_flatten = (l) => {
    return [].concat.apply([], l);
};


let vk_to_flat = (vk) => {
    return [
        list_flatten([
            vk.alpha[0], vk.alpha[1],
            list_flatten(vk.beta),
            list_flatten(vk.gamma),
            list_flatten(vk.delta),
        ]),
        list_flatten(vk.gammaABC)
    ];
};


let proof_to_flat = (proof) => {
    return list_flatten([
        proof.A,
        list_flatten(proof.B),
        proof.C
    ]);
};


contract("TestableMiximus", () => {
    describe("Transactions-proof test", ()=>{
        it("tx proof verify test", async()=>{
            const tx1 = {};
            const tx2 = {};
            const tx3 = {};
            let TXs = [tx1, tx2, tx3];
            let obj = await TestableMiximus.deployed();
            //let leaf_hash = obj.MakeLeafHash.call(TXs);
            let secret = new BN(crypto.randomBytes(30).toString("hex"), 16);
            let leaf_hash = await obj.MakeLeafHash.call(secret);
            let new_root_and_offset = await obj.Deposit.call(leaf_hash, {value: 1000000000000000000});
            let tmp = await obj.GetPath.call(new_root_and_offset[1]); //[minzzii] proof_path, address_bits
            let proof_address = tmp[1].map((_) => _ ? "1" : "0").join("");
            let proof_path = [];
            for( var i = 0; i < proof_address.length; i++ ) {
                proof_path.push( tmp[0][i].toString(10) );
            }
            let proof_root = await obj.GetRoot.call();
            proof_root = new_root_and_offset[0];
            let leaf_index = new_root_and_offset[1];
            //let proof_exthash = await obj.GetExtHash.call();

            //let nullifier = libmiximus.miximus_nullifier(secret.toString(10), leaf_index.toString(10));
            //console.log('Nullifier is', nullifier);
            let proof_pub_hash = await obj.HashPublicInputs.call(proof_root); //leaf_index 넣어줘야할것같음

            // Run prover to generate proof
            let args = [
                MiximusProvingKeyPath,
                proof_root.toString(10),
                //proof_exthash.toString(10),
                secret.toString(10), //leaf_index로 ...바꿔야할듯
                proof_address,
                proof_path
            ];
            let proof_json = libmiximus.miximus_prove(...args);
            assert.notStrictEqual(proof_json, null);
            let proof = JSON.parse(proof_json);
            console.log("[minzzii] proof: ", proof);
        });
    });
/*
    describe("Deposit", () => {
        it("deposits then withdraws", async () => {
            let obj = await TestableMiximus.deployed();

            // Parameters for deposit
            let secret = new BN(crypto.randomBytes(30).toString("hex"), 16);
            let leaf_hash = await obj.MakeLeafHash.call(secret); //[minzzii] MiMC.hash(secret)

            // Perform deposit
            let new_root_and_offset = await obj.Deposit.call(leaf_hash, {value: 1000000000000000000});
            await obj.Deposit.sendTransaction(leaf_hash, {value: 1000000000000000000});


            // TODO: verify amount has been transferred


            // Build parameters for proving
            let tmp = await obj.GetPath.call(new_root_and_offset[1]); //[minzzii] proof_path, address_bits
            let proof_address = tmp[1].map((_) => _ ? "1" : "0").join("");
            let proof_path = [];
            for( var i = 0; i < proof_address.length; i++ ) {
                proof_path.push( tmp[0][i].toString(10) );
            }
            let proof_root = await obj.GetRoot.call();
            proof_root = new_root_and_offset[0];
            let leaf_index = new_root_and_offset[1];
            let proof_exthash = await obj.GetExtHash.call();

            let nullifier = libmiximus.miximus_nullifier(secret.toString(10), leaf_index.toString(10));
            console.log('Nullifier is', nullifier);
            let proof_pub_hash = await obj.HashPublicInputs.call(proof_root, nullifier, proof_exthash);

            // Run prover to generate proof
            let args = [
                MiximusProvingKeyPath,
                proof_root.toString(10),
                proof_exthash.toString(10),
                secret.toString(10),
                proof_address,
                proof_path
            ];
            let proof_json = libmiximus.miximus_prove(...args);
            assert.notStrictEqual(proof_json, null);
            let proof = JSON.parse(proof_json);


            // Ensure proof inputs match what is expected
            assert.strictEqual("0x" + proof_pub_hash.toString(16), proof.input[0]);


            // Re-verify proof using native library
            // XXX: node-ffi on OSX will not null-terminate strings returned from `readFileSync` !
            let vk_json = fs.readFileSync(MiximusVerifyingKeyPath);
            let proof_valid_native = libmiximus.miximus_verify(vk_json + '\0', proof_json);
            assert.strictEqual(proof_valid_native, true);
            let vk = JSON.parse(vk_json);


            // Verify VK and Proof together
            let [vk_flat, vk_flat_IC] = vk_to_flat(vk);
            let test_verify_args = [
                vk_flat,                // (alpha, beta, gamma, delta)
                vk_flat_IC,             // gammaABC[]
                proof_to_flat(proof),   // A B C
                [  
                    proof.input[0]
                ]
            ];
            let test_verify_result = await obj.TestVerify(...test_verify_args);
            assert.strictEqual(test_verify_result, true);


            // Verify whether or not our proof would be valid
            let proof_valid = await obj.VerifyProof.call(
                proof_root,
                nullifier,
                proof_exthash,
                proof_to_flat(proof));
            assert.strictEqual(proof_valid, true);


            // Verify nullifier doesn't exist
            let is_spent_b4_withdraw = await obj.IsSpent(nullifier.toString(10));
            assert.strictEqual(is_spent_b4_withdraw, false);


            // Then perform the withdraw
            await obj.Withdraw(
                proof_root.toString(10),
                nullifier.toString(10),
                proof_to_flat(proof));


            // Verify nullifier exists
            let is_spent = await obj.IsSpent(nullifier.toString(10));
            assert.strictEqual(is_spent, true);


            // TODO: verify balance has been increased
        });
    });
*/
});
