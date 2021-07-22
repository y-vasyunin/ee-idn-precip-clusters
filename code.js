// This script, based on the precipitation data, divides Indonesia into
// three climatic zones: "Anti-monsoon", "Monsoon", and "Semi-monsoon"

// #############################################################################
// ### 1 INPUT VARIABLES ###
// #############################################################################

// ### AREA OF INTEREST ###

var world = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017");  // world boundaries
var countryName = "Indonesia";  // US-recognized country name 

// ### DATA ###

// ERA5 Land Monthly contains monthly means of daily means,
// i.e. accumulations have units "per day"
var era5 = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY");
var era5band = "total_precipitation";  // accumulated liquid and frozen water, m

// ### PERIOD ###

var yearStart = 2000;  // from 1 January
var yearEnd = 2020;  // to 31 December

// ### STYLING & DISPLAY ###

var legendNames = ["Anti-monsoon", "Monsoon", "Semi-monsoon"];
var legendColors = ["#C71585", "#006400", "#FFD700"];

var coloredMonths = [
  "#0882ae", "#4ad5da", "#9cd93a",
  "#84c70e", "#4a9749", "#cf6d6a",
  "#d53853", "#cc4329", "#d95d0a",
  "#da8e05", "#c6045d", "#574fa8"
];

// ### EXPORT ###

var doExport = true;  // save created clusters to Google Drive (GeoTIFF)

var projectName = "PrecipClusters";  // used for export filename
var exportPath = "EarthEngine";  // prefix to your Google Drive folder
var maxPixelCount = 1e13;  // max pixel count for export image (exponential form)
var noData = 9;  // NoData will have this value
var extent = ee.Geometry.Polygon([[  // bounding box around Indonesia
  [94.19, 6.67], [94.19, -11.7],
  [141.69, -11.77], [141.69, 6.67]
  ]]);

// ground sample distance in meters
// usa data-intrinsic value, otherwise specify manually
var gsd = era5.first().projection().nominalScale();  // 11 km = 0.1°

// #############################################################################
// ### 2 FUNCTIONS ###
// #############################################################################

// add month numbers in a new band (integer)
function addMonth(image) {
  return image.addBands(ee.Image.constant(
    ee.Number.parse(image.date().format("MM"))).rename("month").int()
    .reproject(image.select("total_precipitation").projection())
  ).clip(aoi);
}

// convert cluster numbers to user-friendly names
function convertClustName(f) {
  f = ee.Algorithms.If(ee.Number(f.get("cluster")).eq(0), f.set("name", "Anti-monsoon"),
        ee.Algorithms.If(ee.Number(f.get("cluster")).eq(1), f.set("name", "Monsoon"),
          ee.Algorithms.If(ee.Number(f.get("cluster")).eq(2), f.set("name", "Semi-monsoon"), f)
        )
      );
  return f;
}

// identify cluster centers (mean values 0f all parameters)
// according to https://gis.stackexchange.com/a/307773/34438
function getClusterCenters(srcImage, clusterImage, cluserId) {
  var clusterPixels = srcImage.updateMask(clusterImage.eq(cluserId));
  var clusterCenters = clusterPixels.reduceRegion({
    reducer: ee.Reducer.mean(), 
    geometry: aoi, 
    scale: gsd
  });
  return clusterCenters;
}

// map legend: create and style one row
function legendRow(color, name) {
  // create the label that is actually the colored box
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      // use padding to give the box height and width
      padding: "8px",
      margin: "0 0 4px 0"
    }
  });
  // create the label filled with the description text
  var description = ui.Label({
    value: name,
    style: {margin: "0 0 4px 6px"}
  });
  // return the panel
  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow("horizontal")
  });
}

// #############################################################################
// ### 3 IMPLEMENTATION ###
// #############################################################################

// ### DATA PREPARATION ###

// extract a specific country
var aoi = world.filterMetadata("country_na", "equals", countryName);

// remove unnecessary bands from data
var prcp = era5.select(era5band)
  .filter(ee.Filter.calendarRange(yearStart, yearEnd, "year"));

// compute a flat image with statistics from all years
var reducers = ee.Reducer.minMax().combine({
  reducer2: ee.Reducer.mean(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.median(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.stdDev(),
  sharedInputs: true
}).combine({
  reducer2: ee.Reducer.mode(),
  sharedInputs: true
});

var composite = prcp.reduce(reducers).clip(aoi);

// ### CLUSTERING ###

// The same inputs should always produce the same outputs,
// Reordering the inputs can change the results.
// Training with as few as 10 bands * 100k points can produce an Out Of Memory error.

var clusterNum = 3;  // how many precipitation clusters to identify
                     // changing this variable requires adjusting the rest of code

var prcpTimes = prcp.map(addMonth);
// turn image collection into an array
var array = prcpTimes.toArray();
// sort array by the first band, keeping other bands
var axes = {image: 0, band: 1};
var sort = array.arraySlice(axes.band, 0, 1);  // select bands from index 0 to 1 (precipitation)
var sorted = array.arraySort(sort);
// take the first image only (MAX precipitation)
var length = sorted.arrayLength(axes.image);
// for the max value sorted
var valuesMax = sorted.arraySlice(axes.image, length.subtract(1), length);
// for the min value sorted
var valuesMin = sorted.arraySlice(axes.image, 0, 1);
// convert back to an image
var max = valuesMax.arrayProject([axes.band]).arrayFlatten([["total_precipitation", "month"]]);
var min = valuesMin.arrayProject([axes.band]).arrayFlatten([["total_precipitation", "month"]]);
// get the min and max axis by selecting bands 0 and 1
var timeMax = max.select(1).rename("max_month");  // get month
var timeMin = min.select(1).rename("min_month");  // get month
var compositeMonths = composite.addBands([timeMax, timeMin]);
// make the training dataset
var trainingMonths = compositeMonths.sample({
  region: aoi,
  scale: gsd,
  numPixels: 15000,
  // geometries: true
});
// instantiate the clusterer and train it
var clustererMonths = ee.Clusterer.wekaKMeans(clusterNum).train(trainingMonths);
  // cluster the input using the trained clusterer
var climRegions = compositeMonths.cluster(clustererMonths);

// #############################################################################
// ### 4 VISUALIZATION ###
// #############################################################################

// ### CONSOLE ###

for (var clusterNum = 0; clusterNum < legendNames.length; clusterNum++) {
  print(["Cluster centers for", clusterNum, legendNames[clusterNum], ":"].join(" "));
  var clusterCenters = getClusterCenters(compositeMonths, climRegions, clusterNum);
  var roundedClusterCenters = clusterCenters.map(function(key, val) {
    return key, ee.Number(val).format('%.3f');
  });
  print(roundedClusterCenters);
}

// ### BASEMAP ###

var mapStyle= [{"elementType":"geometry","stylers":[{"color":"#f5f5f5"}]},
  {"elementType":"labels.icon","stylers":[{"visibility":"off"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#616161"}]},
  {"elementType":"labels.text.stroke","stylers":[{"color":"#f5f5f5"}]},
  {"featureType":"administrative.land_parcel","elementType":"labels.text.fill","stylers":[{"color":"#bdbdbd"}]},
  {"featureType":"poi","elementType":"geometry","stylers":[{"color":"#eeeeee"}]},
  {"featureType":"poi","elementType":"labels.text.fill","stylers":[{"color":"#757575"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#e5e5e5"}]},
  {"featureType":"poi.park","elementType":"labels.text.fill","stylers":[{"color":"#9e9e9e"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#ffffff"}]},
  {"featureType":"road.arterial","elementType":"labels.text.fill","stylers":[{"color":"#757575"}]},
  {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#dadada"}]},
  {"featureType":"road.highway","elementType":"labels.text.fill","stylers":[{"color":"#616161"}]},
  {"featureType":"road.local","elementType":"labels.text.fill","stylers":[{"color":"#9e9e9e"}]},
  {"featureType":"transit.line","elementType":"geometry","stylers":[{"color":"#e5e5e5"}]},
  {"featureType":"transit.station","elementType":"geometry","stylers":[{"color":"#eeeeee"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#c9c9c9"}]},
  {"featureType":"water","elementType":"labels.text.fill","stylers":[{"color":"#9e9e9e"}]}
  ];
Map.setOptions("Custom", {Custom: mapStyle});

// ### COMPUTED LAYERS ###

Map.centerObject(aoi, 5, true);

// a simple outline for country border
var outline = ee.Image().byte().paint({
  featureCollection: aoi,
  color: 1,
  width: 2
});
Map.addLayer(outline, {palette: ["black"]}, "Country Borders");

var compositeVisMean = {
  "opacity":1,
  "bands": ["total_precipitation_mean"],
  "palette": ["#ADD8E6", "#1E90FF", "#0000CD"],
  "min": 0.002,
  "max": 0.050};
Map.addLayer(compositeMonths, compositeVisMean, "Averaged monthly means of daily means", 0);

Map.addLayer(timeMin, {min: 1, max: 12, palette: coloredMonths}, "Min precip month", false);
Map.addLayer(timeMax, {min: 1, max: 12, palette: coloredMonths}, "Max precip month", false);

var sldSymbolyzer =
'<RasterSymbolizer>' +
  '<ColorMap type="values">' +
    '<ColorMapEntry color="' + legendColors[0] + '" quantity="0" label="' + legendNames[0] + '"/>' +
    '<ColorMapEntry color="' + legendColors[1] + '" quantity="1" label="' + legendNames[1] + '"/>' +
    '<ColorMapEntry color="' + legendColors[2] + '" quantity="2" label="' + legendNames[2] + '"/>' +
  '</ColorMap>' +
'</RasterSymbolizer>';
Map.addLayer(climRegions.sldStyle(sldSymbolyzer), {}, "Climatic regions", true);

// ### LEGEND ###

// set panel position
var legend = ui.Panel({style: {position: "bottom-left", padding: "8px 15px"}});

// create legend title
var legendTitle = ui.Label({
  value: "Climatic regions",
  style: {
    fontWeight: "bold",
    fontSize: "18px",
    margin: "0 0 4px 0",
    padding: "0"
    }
});

// add the title to the panel
legend.add(legendTitle);
 
// add colors and names
for (var i = 0; i < 3; i++) {legend.add(legendRow(legendColors[i], legendNames[i]));}
Map.add(legend);

// #############################################################################
// ### 5 EXPORT ###
// #############################################################################

// transformation of dates to user-friendly names
var dataYear = [yearStart, yearEnd].join("-");
var expDate = ee.Date(Date.now());
var timeStamp = expDate.format("Y-MM-dd_HH-mm-ss-SSS").getInfo();
var filename = [projectName, dataYear, countryName].join("_");

// save GeoTIFF to Google Drive
if (doExport) {
  Export.image.toDrive({
    image: climRegions.unmask(noData),  
    region: extent,
    crs: climRegions.projection(),
		description: [timeStamp, filename].join("_"),
		fileNamePrefix: filename,
    folder: exportPath,
    scale: gsd.round().getInfo(),
    maxPixels: maxPixelCount
  });
} else {
  print("WARNING: Export to Google Drive is deactivated");
}
