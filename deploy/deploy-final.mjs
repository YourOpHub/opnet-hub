import { Wallet, Compressor, DeploymentGenerator } from '@btc-vision/transaction';
import { networks, payments } from '@btc-vision/bitcoin';
import { readFileSync } from 'fs';

const WIF = 'cVVjcKm9g2ZuBVMo7HD4PrfcPmVvr3kRuPkapjVkqqX1JkKgsrTP';
const MLDSA = '6f89f7a086cfebf0d76caca30ae5cbd7684330fcbfa4e5305ed67608bad87a64a0fae401664a7a62224c941aac653ff5a2d233fd8e5603a163fc255521f60bfaf994fa9bcd306114b85cb7da52d0698d4695266db91f8be8a9ba1ecf37addc8211fa39b971063ec9672dc32d36177e3a8c90bfbda0c49d7fab7f0f0b211e62fe21c6495c48481a142d11c08848a82dc33690a04465003351580620c20006e2002688c64113150542b68001160e21226088c60911270e80304601324d9b20101419511a208908079053c06d04120e23082ce4408641b00c1199008114329c408a21146003a02c59864dc93881199484582844c4087013491009420809877191c68d10c1710a397253404a1b361084228658b88d99a40940346154260ad3b67019b3645ac44c6182701229326308321b294084406a190885d2240653023089064493c08ccb407062104090408a40842c18a67104320a40026e64160a249208c116510349201ac245a104419294298898480c18040ab86d0bc968930648d406681b434561c80c00366281322ccc228c980409e44485c3b02449b029a0b070a1380ac0264604148e2428515834269b4244413801618465c30462503212cc341104891150c2850b092818c9311b2204c14250c4404c2112618008711382900c38441a850923b621e2168a6420200419318b24654ca4518112321c296d0b80512424111022225880499c9204040740a0226a98c02c1c800c62466ec3262c20c6686392291cc411222449d1026e24400e43c6248b000aa2320c891001523424d1204589a80024260281362504b1118b34102335229a268e1a3264cb122a02957144200991324510150101024403161221b148a2b66d938221c93225d8c410e41212231212e38405d33869a1b46c10203261c051131840c4046cd3426d52c0500093254b8841083370e11292414810a10041c43031cca08ce03652d30600d4988414074cc218916180280a0268901046a1c40c52003020244edcb8210288909138628c364da4a84051c091d1b69103a73099080e0345700246685b180950886104a22004210c4230080bb12dc0860d131172cc068a94a82c092025233229888231a2c04001b08ccc404c43386e1490640412119cb8100c26411a082981946cd2462464108452b411a3486d0ac74d58386d492009ccc48cc388641b255253c224d922084ac28489301052800c40a04582308ea18820dcc8891b118c022590808648d34468cee87c8ce76938b79954f6a5928d64277dbddc7493c80dd80eb68f55a5e282d42c42b5052e68ff5d27644dbad14cc374faa2e571462978710fd10faac2045844c9ace496ef38cc0cdb5a0f0a8380c92a452e7ab271d7840ca89ab98ae5ce254fccbeba98d8811dfb16c55a5aebc2ba359592ebc7ede719d6cbafd4726227d393dcd1987aaeb60011e0223e0c662b817d5f9e1738d1b911c042443bbb658c628cca5a368c773cdc4854171676c14c77dcd5172b491584463d0d0f4b3ee8afdca55db7ef9a3fabd76d0e6dc598489fdd2712b39d41243a1d9a6d00caff13afc978af6db7552c3e8114ef33a24d53889f9b86a2e448961c152c023c7a802f6eb7dd26061e92a2446105fb19e467943c6279221d0e99d43181d72aab2fd06edd7089e3a07b42f575528d0be6e7cec782cf73a32660636dbe37807ab9a21fb0bf60cbdfce5592abf66cb2177ee20eb0028ac553217b787cdb6177c80ad329f693bff933a11039d055366455a6d0fb79a5dc3f87d6a515d10eccdee628f6b6cf0f67cadf9df2851190fb122e28fc816037054adafd5c7e5be8701ca93e0100bdb2daea48740e0008a7dca61ea344b7bdf4061ec27587c33d6d2c25c6a6e2e7bd2bc492a709f4bc4d777ec42bfa1d7d8d0f51597e9ff30806d90f1cfbc33c7c514706305a29b914342577d7664ce002b6ee8f68ac75c991ba24600f4764ebe526f8b3ce9d6cb0b796cc63070c04f486e0f2b41023aef21aa153bb434d0ef7432f5771811948a5ea858384a48f7360e2d504cf906ac1556c9209c5c39ef59c1f3589e978653014551c09cb903ad850fe0f2f23d0cb44c7f02d1e211224797a4443847b6732599fea5d9211f2a8f431210e39493e74fa35a6e2b779b9f7539acb3dc5575e3c4772d25e1d4916ee5bf9a40878a3a6a009be3056feda4c64e75c1497e044cd979b291a6c8193815071a41e3476db7789fa91be20a44da03487f3baa08f7e0fd95719bfbdad9f7e26f2a19673b3bb607a1ada159a8678e84947a98517361d05f45951b2594a866897b773510108506c7f0d554847dc519b324ea6973f6fb7f35cb127c110a12c4bfb668e0f4a4ae44279ca32b68fb2d14a67027529860d9451a90c404f3ea00372c5e812559a3a76c3f1f80c5cf196f5382fefbc4097080b50647dca726f17489af60e7f9a06f2273bb1776187de45bda81cc698e2fe83cfda0b843f4c0dd5177c649e812ec6adc408b03bb596d7a829d3d81aac9597707fd9a70ef12f9c47dc54ca9b4ee71daa9d0d09acda824f91ee3c2e6426d02baea03c001315535c49a9e6b7be5f0fd301d55ff832c07704eb1c03a6388aef4527d07637ed8a286bc24b054443f3c8c1caf4a8982d07611a5f77df4e280bf57d50a0243449838c05842b5dc7eac09441046d04e88e1a9f08a6d3d202c2797faf2e945dcbfa6a2cae039eebfe5cffbd911030f9c50b68f3a1cd9de541bb1bdc6af3fe837463c301f811ebc8699ee58d3e0dbf86cebaac08f55c40d58ef107511b7ec2d720b06d86c75f1bae4d74f073529a9ad8d452f0b17471b6da4bc6d3524987366122f78cb32e71340c9f9d997e2122d28b752d257d891096486293322dc5aee7d359cfd0a00a6853f00cc48b8fa6186825592f018c07a45265b752f38172b186c1aa9342bf15f9082a58e2c7879bcf34b2afd7ec43b5adedaa0a17cec0c3ac31beb3368f3400fd2ef5122241845bc7207fd20ce89429d672cbb3b3fbe3a74055a34aafbf7ee3d38f3432b88a425a174d3d678277d0024ffcc15b23f1f3053b34a90c47942818fb9ad5eb95f35ae1eade637c6fbc61ea8cf9f0e4dfcfc8c9e10acf4485308e7de746f66c089911a05353eee210f38ecc41b11db9dd7f8d77551e37b7d7fa3295c151694788037d43a71f67161954c61fa6d31cda7ef499dea055f9e28af5d387b6f162865a26d337c4cf260d479bd6375d05c628129cc22d6a33284b30662e90b5709364eb0f0296f7f66783c17fa500e18da0d2566d2e26730f5ce0e1f5d288d76a665462c8871e34207894435509c950f7cd00c63ebecf9f963297297da0f9f5222459af6b2ce432653add3350aaebbedb1c0c53579f54c635d690fa0c6a13aa6cc02c08179397b7cbfe5d90c6d6985c62eaf6204da09de1e88d64c8ac8018ae45abf18c33214485941a80e4624b625635b0ec2b4610d30fc797e2a0cad54e1daaaccd523ce21fedd643b0fe23942e1d3ac36cc15c0f65188ba1c00b0c8e5fc11a6a41fce6b1178e1efed21836e8951e09074ca3f813820538a80f9acdec2f9709a316a0eabbc06d4917287c214d433472f6fb9badbc1747530c';
const opnetTestnet = { ...networks.testnet, bech32: 'opt' };

async function rpc(method, params = []) {
    const r = await fetch('https://testnet.opnet.org/api/v1/json-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
    });
    const d = await r.json();
    if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
    return d.result;
}

async function main() {
    console.log('=== $MINE Token Deploy ===');
    
    // 1. Create wallet with both keys
    const wallet = new Wallet(WIF, MLDSA, opnetTestnet);
    const address = wallet.p2tr;
    console.log('Address:', address);
    console.log('Has keypair:', !!wallet.keypair);
    console.log('Has MLDSA:', !!wallet.mldsaKeypair);
    
    // 2. Check balance
    const bal = parseInt(await rpc('btc_getBalance', [address]), 16);
    console.log('Balance:', bal, 'sats');
    
    // 3. Get UTXOs
    const utxoData = await rpc('btc_getUTXOs', [address, { optimized: false }]);
    const confirmed = utxoData.confirmed || [];
    console.log('UTXOs:', confirmed.length);
    
    if (!confirmed.length) { console.log('ERROR: No UTXOs'); process.exit(1); }
    
    // 4. Load and compress WASM
    const wasm = readFileSync('OP_20/build/MyToken.wasm');
    const bytecode = await Compressor.compress(wasm);
    console.log('WASM:', wasm.length, '-> compressed:', bytecode.length);
    
    // 5. Get gas params
    const gas = await rpc('btc_gas');
    const feeRate = Math.ceil(parseFloat(gas.bitcoin?.conservative || '2'));
    console.log('Fee rate:', feeRate, 'sat/vB');
    
    // 6. Format UTXOs for SDK
    const utxos = confirmed.map(u => ({
        transactionId: u.transactionId,
        outputIndex: u.outputIndex,
        value: BigInt(u.value),
        scriptPubKey: {
            hex: u.scriptPubKey.hex,
            address: u.scriptPubKey.address,
        },
    }));
    
    // 7. Create deployment generator
    console.log('Creating DeploymentGenerator...');
    const pubkey = wallet.keypair.publicKey;
    const dg = new DeploymentGenerator(pubkey, opnetTestnet);
    console.log('DeploymentGenerator OK');
    
    // 8. Generate deployment data
    console.log('Generating deployment...');
    const deployData = dg.compile({
        bytecode,
        utxos,
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network: opnetTestnet,
        feeRate,
        priorityFee: 1000n,
        from: address,
    });
    
    console.log('Deployment generated!');
    console.log('Result:', JSON.stringify(deployData).slice(0, 500));
    
    // 9. Broadcast
    if (deployData.tx || deployData.hex) {
        const rawTx = deployData.hex || deployData.tx;
        console.log('Broadcasting...');
        const txid = await rpc('btc_sendRawTransaction', [rawTx]);
        console.log('TX ID:', txid);
        console.log('=== DEPLOY SUCCESS ===');
    }
}

main().catch(e => {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack?.split('\n').slice(0, 8).join('\n'));
});
