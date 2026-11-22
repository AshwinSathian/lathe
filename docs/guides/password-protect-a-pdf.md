# How to password protect a PDF

To encrypt a PDF, open [Protect PDF](https://lathe.ashwinsathian.com/protect-pdf), add your file, enter a password and download the result. Lathe encrypts it with AES-256 on your device, and the password is never stored or sent anywhere.

## Choose a strong password

AES-256 protects a file only as well as its password. A short or common password can be guessed offline by anyone holding the file. Use a long passphrase from a password manager, and send it by a different channel from the file. If you lose it, the file cannot be recovered.

## Permissions

You can also block printing, editing or copying. These restrictions are honoured by compliant PDF readers but are not strong security, because other software can ignore them once the file is open. Only the open password actually encrypts access to the content.

## Removing a password

[Unlock PDF](https://lathe.ashwinsathian.com/unlock-pdf) removes a password you know. Lathe does not crack passwords. A file with permission restrictions but no open password can be opened by any tool, and the result tells you that the restrictions were not kept.
