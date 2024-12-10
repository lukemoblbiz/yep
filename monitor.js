import {
  clusterApiUrl,
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
 
(async () => {
  // connection
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
 
  // 5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CmPEwKgVWr8
  const feePayer = Keypair.fromSecretKey(
    bs58.decode(
      "588FU4PktJWfGfxtzpAAXywSNt74AvtroVzGfKkVN1LwRuvHwKGr851uH8czM5qm4iqLbs1kKoMKtMJG4ATR7Ld2",
    ),
  );
 
  // G2FAbFQPFa5qKXCetoFZQEvF9BVvCKbvUZvodpVidnoY
  const alice = Keypair.fromSecretKey(
    bs58.decode(
      "5YwEjx3EAmoJMC8m4nbZPMGwaV634JjRcn2NMELyPmSkMy9VMxFYK9CGAmsCPc3YcL18rYMBrSyTkokyfHtwXCTd",
    ),
  );
 
  const mintPubkey = new PublicKey(
    "MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u",
  );
 
  // 1) use build-in function
  {
    let ata = await createAssociatedTokenAccount(
      connection, // connection
      feePayer, // fee payer
      mintPubkey, // mint
      alice.publicKey, // owner,
    );
    console.log(`ATA: ${ata.toBase58()}`);
  }
 
  // or
 
  // 2) composed by yourself
  {
    // calculate ATA
    let ata = await getAssociatedTokenAddress(
      mintPubkey, // mint
      alice.publicKey, // owner
    );
    console.log(`ATA: ${ata.toBase58()}`);
 
    // if your wallet is off-curve, you should use
    // let ata = await getAssociatedTokenAddress(
    //   mintPubkey, // mint
    //   alice.publicKey // owner
    //   true, // allowOwnerOffCurve
    // );
 
    let transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        feePayer.publicKey, // payer
        ata, // ata
        alice.publicKey, // owner
        mintPubkey, // mint
      ),
    );
 
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [feePayer], // Signers
    );
 
    console.log(`txhash: ${await signature}`);
  }
})();