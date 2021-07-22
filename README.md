# Identifying climatic regions in Indonesia

This code is used in an scholarly publication on wildfires in Indonesia. It is developed to be run inside the [Google Earth Engine](https://earthengine.google.com/) platform. You need to have both Google (Gmail) and Google Earth Engine accounts in order to use it.

The code allows studying the precipitation distribution for the whole Indonesia by making clusters from [ERA5-Land monthly averaged - ECMWF climate reanalysis](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_MONTHLY) data. You are free to change input variables, such as the period for data clustering or area of interest.

![](screenshot.png)

In its current realization, it computes three clusters based on a *total precipitation* band and saves the result as a GeoTiff file (WGS84).

## Developers

  - [Vasily Lobanov](https://www.linkedin.com/in/vasyunin), RUDN University, Moscow
  - [Yaroslav Vasyunin](https://www.linkedin.com/in/lobanov-v/), independent researcher, Italy

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/y-vasyunin/ee-idn-precip-clusters/blob/main/LICENSE).
