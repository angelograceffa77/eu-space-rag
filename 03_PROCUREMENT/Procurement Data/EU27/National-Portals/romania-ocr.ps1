param([string]$Pdf,[string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$generic=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1})[0]
function Await($Operation,$Type){$task=$generic.MakeGenericMethod($Type).Invoke($null,@($Operation));$task.GetAwaiter().GetResult()}
function AwaitAction($Operation){$method=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1})[0];$task=$method.Invoke($null,@($Operation));$task.GetAwaiter().GetResult()}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
$doc=Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$results=@()
for($index=0;$index -lt $doc.PageCount;$index++){
$page=$doc.GetPage($index);$stream=[Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
$options=[Windows.Data.Pdf.PdfPageRenderOptions]::new();$options.DestinationWidth=2200
AwaitAction ($page.RenderToStreamAsync($stream,$options))
$stream.Seek(0)
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$results+=@{page=$index+1;text=$result.Text}
[IO.File]::WriteAllText($Output,($results|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
if($index -eq 0){$stream.Seek(0);$input=[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream);$dest=[IO.File]::Create(($Output+'.page1.png'));$input.CopyTo($dest);$dest.Close()}
$bitmap.Dispose();$stream.Dispose();$page.Dispose()
Write-Output ('OCR page '+($index+1)+'/'+$doc.PageCount)
}
